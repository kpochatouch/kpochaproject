// apps/web/src/lib/awsLivenessClient.js
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";

const region = import.meta.env.VITE_AWS_REGION || "us-east-1";
const identityPoolId = import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID;

let client = null;

export function getRekClient() {
  if (client) return client;

  client = new RekognitionClient({
    region,
    credentials: fromCognitoIdentityPool({
      clientConfig: { region },
      identityPoolId,
    }),
  });

  return client;
}
