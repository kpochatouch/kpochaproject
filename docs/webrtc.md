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

### Web client
- `apps/web/src/components/CallSheet.jsx`
  - `pendingOfferRef` for early offer
  - `pendingIceRef` for early ICE
  - flush logic after `setRemoteDescription`

### Signaling transport
- `apps/web/src/lib/webrtc/SignalingClient.js`
  - always emits `{ room, payload }` for backend compatibility
  - keeps handler bookkeeping so we can `off()` cleanly

### Backend
- `apps/api/sockets/index.js`
  - forwards `webrtc:offer|answer|ice` to room
  - ACK includes `deliveredTo` and `totalInRoom` for proof-based debugging
- `apps/api/routes/webrtc.js`
  - ICE server config is served from env vars

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
