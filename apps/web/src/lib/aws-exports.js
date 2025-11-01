// apps/web/src/lib/aws-exports.js
export default {
  aws_project_region: import.meta.env.VITE_AWS_REGION,
  aws_cognito_identity_pool_id: import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID,
  aws_cognito_region: import.meta.env.VITE_AWS_REGION,
};
