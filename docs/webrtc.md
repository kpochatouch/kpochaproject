# WebRTC Calling: Why the Fix Works (Golden Commit Notes)

This document explains the root cause of the call failures we saw across devices/networks and why the “stash + flush” signaling fix made calls reliable.

## What was breaking

### 1) Offer can arrive before the receiver taps “Accept”

On real networks (mobile data, different WiFi, higher latency), the caller can generate and send the SDP offer immediately.
The receiver UI may still be showing “Incoming call” and hasn’t created an `RTCPeerConnection` yet.

**Result:** the receiver gets `webrtc:offer`, but has no peer connection to apply it to, so the offer is lost or applied too late.

### 2) ICE candidates can arrive before `remoteDescription`

ICE candidates are discovered and sent rapidly.
It is normal for ICE messages to arrive before the remote SDP is set via `pc.setRemoteDescription(...)`.

**If you call `pc.addIceCandidate(...)` before `remoteDescription` is set**, many browsers will reject it (or behave inconsistently), causing ICE to fail.

**Result:** signaling appears fine (offers/answers delivered), but the peers never find a working network path, so calls time out.

## Why it used to work only on same WiFi / LAN

Local networks often have:

- faster delivery
- lower jitter
- fewer NAT/firewall obstacles

So timing issues (offer/ICE arriving “too early”) are less likely.  
Across mobile data / different WiFi, messages can be reordered or delayed enough to trigger the failure modes above.

## The Fix: “Stash + Flush” (Timing-Safe Signaling)

### A) Stash offer until the receiver accepts

If `webrtc:offer` arrives while the receiver UI is still waiting for Accept:

- store the offer in `pendingOfferRef`
- after Accept (when `RTCPeerConnection` exists), apply it via:
  - `pc.setRemoteDescription(offer)`
  - create/send answer

✅ This guarantees the receiver never loses the offer.

### B) Stash ICE until `remoteDescription` exists, then flush

If `webrtc:ice` arrives and `pc.remoteDescription` is not set:

- push candidate into `pendingIceRef`
- once `setRemoteDescription(...)` completes:
  - flush queue in order with `addIceCandidate(...)`

✅ This prevents invalid early `addIceCandidate` calls and stabilizes ICE negotiation on all networks.

## What “success” looks like in logs

On good runs, you will see:

- signaling ACKs with `deliveredTo: 1` on offer/answer/ice
- `iceConnectionState: connected`
- `connectionState: connected`

If it fails, you often see:

- `iceConnectionState: disconnected/failed`
- timeout: “no WebRTC connection within 20 seconds”

## Regression Test Checklist (Manual)

Run these after any call-related change.

### Network matrix

- [ ] Same WiFi (both devices on same network)
- [ ] Different WiFi networks
- [ ] Mobile data ↔ WiFi (phone on data, laptop on WiFi)
- [ ] Laptop ↔ phone (both directions)

### Client matrix

- [ ] Chrome ↔ Chrome
- [ ] Chrome ↔ Firefox (or Safari on iOS, if applicable)
- [ ] 2 different devices (desktop + phone)

### Functional expectations

- [ ] Receiver can tap Accept and connect reliably
- [ ] Audio path works both ways
- [ ] Hang up ends the call for both sides
- [ ] No repeated stuck “Connecting…” state

## Implementation Notes (Where the fix lives)

### Call flow in the app

#### Caller flow

- `apps/web/src/pages/Chat.jsx` and `apps/web/src/pages/BookingChat.jsx` start calls via `initiateCall(...)`.
- They request `navigator.mediaDevices.getUserMedia(...)` first, so a call record is only created after microphone/camera permissions succeed.
- When the call is initiated, the app dispatches `kpocha:start-call` and the global app listener opens `apps/web/src/components/CallSheet.jsx`.

#### Incoming call flow

- `apps/web/src/App.jsx` listens for socket events such as `call:incoming` and `call:status`.
- `CallSheet.jsx` is responsible for the live call UI, peer connection lifecycle, ringing state, accept/decline actions, and cleanup.
- It also handles native Android auto-accept and remote hangup via `call:status`.

#### Chat and thread integration

- `apps/web/src/components/ChatPane.jsx` normalizes chat messages and `meta.call` payloads so call bubbles and status updates render correctly.
- `apps/web/src/pages/Inbox.jsx` surfaces call thread previews, including missed/ended call summaries.
- `apps/web/src/pages/Notifications.jsx` is part of the same notification/event system and presents call-related activity targets.

### Signaling transport

- `apps/web/src/lib/webrtc/SignalingClient.js`
  - queues signaling events until `room:join` is acknowledged by the backend
  - flushes pending `webrtc:offer|answer|ice` messages after the room join completes
  - always sends `{ room, payload }` so backend handlers can match the room

### Backend

- `apps/api/sockets/index.js`
  - handles `room:join`, `call:initiate`, `call:ready`, `call:status`, and forwarding of `webrtc:offer|answer|ice`
  - emits `webrtc:*` ACKs with `deliveredTo` and `totalInRoom` so the client can detect empty or missing recipients
- `apps/api/routes/webrtc.js`
  - serves `/api/webrtc/ice`
  - constructs STUN/TURN `iceServers` from `ICE_STUN_URLS`, `ICE_TURN_URLS`, `ICE_TURN_USERNAME`, and `ICE_TURN_PASSWORD`
  - falls back to public Google STUN servers when no env values are set

### Android native call support

- `apps/web/android/app/src/main/AndroidManifest.xml` declares native call permissions needed for WebRTC and full-screen incoming call handling:
  - `RECORD_AUDIO`, `CAMERA`, `MODIFY_AUDIO_SETTINGS`, `WAKE_LOCK`
  - `FOREGROUND_SERVICE`, `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE_PHONE_CALL`
- `apps/web/android/app/src/main/java/touch/kpocha/app/MainActivity.java`
  - configures the Capacitor WebView for autoplay and deep-link fallbacks
  - handles `onNewIntent` so native call actions can route into the SPA via `capacitor://localhost/...`
- `apps/web/android/app/src/main/java/touch/kpocha/app/IncomingCallActivity.java`
  - full-screen lockscreen incoming call UI with swipe accept/decline/message gestures
  - accepts/declines calls via native buttons and gestures, then routes back into the web call flow
- `apps/web/android/app/src/main/java/touch/kpocha/app/CallForegroundService.java`
  - runs a foreground service while a native incoming call is ringing
  - loops ringtone audio separately from Android notification sound
  - auto-stops after a ring timeout and clears the active call session
- `apps/web/android/app/src/main/java/touch/kpocha/app/CallNotification.java`
  - builds the incoming call notification channel and full-screen intent
  - renders Accept/Decline actions and keeps the channel silent so ringtone playback is handled by the service
- `apps/web/android/app/src/main/java/touch/kpocha/app/CallActionReceiver.java`
  - handles native accept/decline button presses
  - Accept opens the SPA via deep link: `/browse?call=1&accept=1&callId=...&room=...`
- `apps/web/android/app/src/main/java/touch/kpocha/app/CallMessagingService.java`
  - receives Firebase data messages for `incoming_call`
  - starts native foreground ringing only when the app is backgrounded
- `apps/web/android/app/src/main/java/touch/kpocha/app/CallSession.java`
  - deduplicates incoming calls and avoids stale/duplicate incoming screens
  - tracks active and accepted call IDs across the native call lifecycle

## Quick Troubleshooting

### If signaling ACK says deliveredTo=0

The other peer isn’t in the room.
Check:

- both sides are using the same `room` string (e.g. `call:<callId>`)
- receiver joined room before caller sends offer (or that the offer is being stashed)

### If signaling ACK is fine but ICE fails

Likely NAT/firewall/TURN problem.
Check:

- TURN URLs/username/password are present in backend env
- client is receiving TURN in `/api/webrtc/ice` response
- try forcing TURN-only temporarily (debugging)

### If it works locally but not on deployed

Check:

- CORS_ORIGIN includes the exact Vercel domains
- sockets connect over WSS successfully
- API base URL and socket root are correct
