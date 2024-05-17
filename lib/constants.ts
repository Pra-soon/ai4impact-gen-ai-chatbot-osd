export const AUTHENTICATION = true;

// change these as needed
// kendraIndexName - must be unique to your account
export const kendraIndexName = 'gen-ai-chatbot-index'
// must be unique globally or the deployment will fail
export const cognitoDomainName = "genaimvp-auth"
// this can be anything that would be understood easily, but you must use the same name
// when setting up a sign-in provider in Cognito
export const OIDCIntegrationName = "Azure-OIDC"