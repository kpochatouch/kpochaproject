// apps/api/scripts/upsert_trusted_profiles.js
// Runs inside mongosh: mongosh "%MONGODB_URI%" --file upsert_trusted_profiles.js

const trustedUIDs = [
  "B2bKz4JlnBS1uyvLzMdPEMCradO2",
  "BlqGQDJFfEPYfICDhn0QbfrU3tk2",
  "DQL66JtBNmfUhJ1ZKdo09KAkwNN2",
  "EVdxL1Jnywh6YVBVtfhhdzvnMHd2",
  "MzGyV7ga1Xb56lgocs0a5xVb6Xy2",
  "aF9c8coAnoUw8SbL8A7tLvz1uT72",
  "cjwycDhzq8X0ajAR9f5zpjIVXPI3",
  "db6eYvhRGvTsstDo4nWjBckZ4wl1",
  "g2sPTuIcXIODM9zIEJ9FTdzT6Xv2",
  "ldzCvKGbGheOtHQ3qvKs1nMRdDg2",
  "m4rJhZ4GZ8a1HNpprdrH14mSqMz2",
  "ne84vSoBWYdQDI6z7RoR9LomfQg1",
  "vT7zQ3r2sDXie4G25eTgVt3W6J53",
  "wZpIwSUbkWUe2Exha5orYUAMFmj2",
];

const firebaseCsv = [
  {
    uid: "B2bKz4JlnBS1uyvLzMdPEMCradO2",
    email: "buildyourownwebsite321@gmail.com",
    name: "Build Website",
    photoUrl: "",
  },
  {
    uid: "BlqGQDJFfEPYfICDhn0QbfrU3tk2",
    email: "alexsimple8@gmail.com",
    name: "Alex Simple",
    photoUrl: "",
  },
  {
    uid: "DQL66JtBNmfUhJ1ZKdo09KAkwNN2",
    email: "ibhadode4out@gmail.com",
    name: "Emmanuel Ebosetale Ibhadode",
    photoUrl: "",
  },
  {
    uid: "EVdxL1Jnywh6YVBVtfhhdzvnMHd2",
    email: "stanleyamar27@gmail.com",
    name: "Stanley Amar",
    photoUrl: "",
  },
  {
    uid: "MzGyV7ga1Xb56lgocs0a5xVb6Xy2",
    email: "giannadiego8@gmail.com",
    name: "Gianna Diego",
    photoUrl: "",
  },
  {
    uid: "aF9c8coAnoUw8SbL8A7tLvz1uT72",
    email: "hannahben665@gmail.com",
    name: "Hannah Ben",
    photoUrl: "",
  },
  {
    uid: "cjwycDhzq8X0ajAR9f5zpjIVXPI3",
    email: "benbruceout@gmail.com",
    name: "Ben Bruce",
    photoUrl: "",
  },
  {
    uid: "db6eYvhRGvTsstDo4nWjBckZ4wl1",
    email: "kpochaout@gmail.com",
    name: "Emmanuel Ibhadode",
    photoUrl: "https://lh3.googleusercontent.com/a/ACg8ocL2Hx5...",
  },
  {
    uid: "g2sPTuIcXIODM9zIEJ9FTdzT6Xv2",
    email: "theorderoftheapostate@gmail.com",
    name: "The Apostate",
    photoUrl: "",
  },
  {
    uid: "ldzCvKGbGheOtHQ3qvKs1nMRdDg2",
    email: "princeb75@gmail.com",
    name: "Ibhadode Silas",
    photoUrl: "https://lh3.googleusercontent.com/a/ACg8ocL2Hx5...",
  },
  {
    uid: "m4rJhZ4GZ8a1HNpprdrH14mSqMz2",
    email: "ofureenas@gmail.com",
    name: "",
    photoUrl: "",
  },
  {
    uid: "ne84vSoBWYdQDI6z7RoR9LomfQg1",
    email: "silasbelieve29@gmail.com",
    name: "Believe Silas",
    photoUrl: "",
  },
  {
    uid: "vT7zQ3r2sDXie4G25eTgVt3W6J53",
    email: "albertnelso321@gmail.com",
    name: "Albert Nelson",
    photoUrl: "",
  },
  {
    uid: "wZpIwSUbkWUe2Exha5orYUAMFmj2",
    email: "hospitaltonature@gmail.com",
    name: "Hospital To Nature",
    photoUrl: "",
  },
];

firebaseCsv.forEach((u) => {
  db.profiles.updateOne(
    { uid: u.uid },
    {
      $set: {
        email: u.email,
        displayName: u.name || u.email,
        fullName: u.name || "",
        avatar: u.photoUrl || null,
        isTrusted: true,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  print("Upserted", u.uid);
});

print("DONE.");
