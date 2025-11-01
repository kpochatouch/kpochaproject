// apps/web/src/aws-exports.js
const region = import.meta.env.VITE_AWS_REGION || "us-east-1";
const identityPoolId =
  import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID || "";

if (!identityPoolId) {
  // This will show in browser console if Vercel env is missing
  console.warn(
    "[AWS] VITE_AWS_COGNITO_IDENTITY_POOL_ID is missing. Liveness will fail."
  );
}

export default {
  aws_project_region: region,
  aws_cognito_region: region,
  aws_cognito_identity_pool_id: identityPoolId,
  Auth: {
    region,
    identityPoolId,
  },
};
