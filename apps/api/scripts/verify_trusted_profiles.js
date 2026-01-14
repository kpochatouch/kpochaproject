// apps/api/scripts/verify_trusted_profiles.js
const expected = {
  B2bKz4JlnBS1uyvLzMdPEMCradO2: {
    email: "buildyourownwebsite321@gmail.com",
    name: "Build Website",
  },
  BlqGQDJFfEPYfICDhn0QbfrU3tk2: {
    email: "alexsimple8@gmail.com",
    name: "Alex Simple",
  },
  DQL66JtBNmfUhJ1ZKdo09KAkwNN2: {
    email: "ibhadode4out@gmail.com",
    name: "Emmanuel Ebosetale Ibhadode",
  },
  EVdxL1Jnywh6YVBVtfhhdzvnMHd2: {
    email: "stanleyamar27@gmail.com",
    name: "Stanley Amar",
  },
  MzGyV7ga1Xb56lgocs0a5xVb6Xy2: {
    email: "giannadiego8@gmail.com",
    name: "Gianna Diego",
  },
  aF9c8coAnoUw8SbL8A7tLvz1uT72: {
    email: "hannahben665@gmail.com",
    name: "Hannah Ben",
  },
  cjwycDhzq8X0ajAR9f5zpjIVXPI3: {
    email: "benbruceout@gmail.com",
    name: "Ben Bruce",
  },
  db6eYvhRGvTsstDo4nWjBckZ4wl1: {
    email: "kpochaout@gmail.com",
    name: "Emmanuel Ibhadode",
  },
  g2sPTuIcXIODM9zIEJ9FTdzT6Xv2: {
    email: "theorderoftheapostate@gmail.com",
    name: "The Apostate",
  },
  ldzCvKGbGheOtHQ3qvKs1nMRdDg2: {
    email: "princeb75@gmail.com",
    name: "Ibhadode Silas",
  },
  m4rJhZ4GZ8a1HNpprdrH14mSqMz2: {
    email: "ofureenas@gmail.com",
    name: "Ofure Enabulu",
  },
  ne84vSoBWYdQDI6z7RoR9LomfQg1: {
    email: "silasbelieve29@gmail.com",
    name: "Believe Silas",
  },
  vT7zQ3r2sDXie4G25eTgVt3W6J53: {
    email: "albertnelso321@gmail.com",
    name: "Albert Nelson",
  },
  wZpIwSUbkWUe2Exha5orYUAMFmj2: {
    email: "hospitaltonature@gmail.com",
    name: "Hospital To Nature",
  },
  // add your 17th test UID here if you want it verified too, e.g.
  // "YOUR_TEST_UID": { email: "devtest@example.com", name: "Dev Test" },
};

const uids = Object.keys(expected);
print("Verifying", uids.length, "trusted UIDs.");

uids.forEach((uid) => {
  const prof = db.profiles.findOne({ uid });
  if (!prof) {
    print(`MISSING profile for UID: ${uid}`);
    return;
  }
  const gotEmail = prof.email || "(no email)";
  const gotDisplay = prof.displayName || "(no displayName)";
  const gotFull = prof.fullName || "(no fullName)";
  const gotAvatar = prof.avatar || prof.photoUrl || "(no avatar)";

  const exp = expected[uid];

  // quick mismatch flags
  const emailMismatch =
    exp.email && exp.email.toLowerCase() !== (gotEmail + "").toLowerCase();
  const nameMismatch =
    exp.name &&
    exp.name !== "" &&
    exp.name !== gotFull &&
    exp.name !== gotDisplay;

  print("----------------------------------------------------------");
  print("UID:", uid);
  print(
    " expected.email:",
    exp.email,
    "  got.email:",
    gotEmail,
    emailMismatch ? " <-- MISMATCH" : "",
  );
  print(
    " expected.name :",
    exp.name || "(empty)",
    "  got.displayName:",
    gotDisplay,
    "  got.fullName:",
    gotFull,
    nameMismatch ? " <-- MISMATCH" : "",
  );
  print(" avatar:", gotAvatar);
  print(
    "raw sources:",
    JSON.stringify(prof.fieldSources || prof.rawSamples || {}),
  );
});
print("Verification done.");
