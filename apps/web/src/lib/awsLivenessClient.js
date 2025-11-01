// apps/web/src/lib/awsLivenessClient.js

import { Amplify } from "aws-amplify";
import awsExports from "../aws-exports";

// read from Vite env first, then from aws-exports.js, then fallback
const region =
  import.meta.env.VITE_AWS_REGION ||
  awsExports.aws_project_region ||
  "us-east-1";

const identityPoolId =
  import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID ||
  awsExports.aws_cognito_identity_pool_id ||
  "";

let configured = false;

/**
 * Configure Amplify once for liveness.
 * We don't put any JSX here — this is just setup code.
 */
export function ensureAwsConfigured() {
  if (configured) return;

  Amplify.configure({
    ...awsExports,
    Auth: {
      // Cognito Identity Pool (the one you showed in screenshot)
      identityPoolId,
      region,
    },
  });

  configured = true;
}

/**
 * Convenience getter for pages/components.
 */
export function getAwsLivenessConfig() {
  ensureAwsConfigured();
  return {
    region,
    identityPoolId,
  };
}

export default getAwsLivenessConfig;
