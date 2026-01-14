// apps/web/src/aws-exports.js
const region = import.meta.env.VITE_AWS_REGION || "us-east-1";
const identityPoolId = import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID || "";

if (!identityPoolId) {
  // 👇 This message appears only in the developer console
  console.warn(
    "[Kpocha] Face verification service is not configured. Please set VITE_AWS_COGNITO_IDENTITY_POOL_ID in your environment.",
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
