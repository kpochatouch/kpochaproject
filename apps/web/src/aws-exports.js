// Minimal Amplify config for Rekognition Face Liveness
export default {
  aws_project_region: import.meta.env.VITE_AWS_REGION || "us-east-1",
  aws_cognito_identity_pool_id: import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID,
  aws_cognito_region: import.meta.env.VITE_AWS_REGION || "us-east-1",
};
