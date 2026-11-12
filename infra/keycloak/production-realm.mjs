// Generates the production realm (M8.3, ADR 0034) from the development realm,
// so both keep the same clients, roles, tokens and security settings:
//   node infra/keycloak/production-realm.mjs           write realm-production/pythagoras-realm.json
//   node infra/keycloak/production-realm.mjs --check   fail if the written file is out of date
//
// What production changes:
// - no synthetic users and no password-grant test client; the only user is
//   the provisioning service account;
// - redirect addresses for the portal and the CMS from the environment;
// - a step-up sign-in flow: a password, and a one-time code when the portal
//   asks for the "mfa" level, which it does for staff (the API decides who is
//   staff); the code is set up at the first such sign-in;
// - e-mail through the platform's SMTP service, for password reset, address
//   verification and the set-up e-mail for new accounts.
// ${NAME} placeholders are filled from the environment when Keycloak imports
// the realm (infra/keycloak/entrypoint.sh); none of them is a secret in this file.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const source = here('./realm/pythagoras-realm.json');
const target = here('./realm-production/pythagoras-realm.json');

const DEVELOPMENT_CLIENTS = new Set(['pythagoras-dev-tests']);
const BROWSER_FLOW = 'pythagoras browser';
// How long a level holds within one Keycloak session: the session's own maximum.
const LEVEL_MAX_AGE = '36000';

export function productionRealm(development) {
  const realm = structuredClone(development);
  delete realm.attributes._development_only;

  realm.attributes['acr.loa.map'] = JSON.stringify({ password: 1, mfa: 2 });
  realm.otpPolicyType = 'totp';
  realm.otpPolicyAlgorithm = 'HmacSHA1';
  realm.otpPolicyDigits = 6;
  realm.otpPolicyPeriod = 30;
  realm.otpPolicyLookAheadWindow = 1;
  realm.browserFlow = BROWSER_FLOW;
  realm.authenticationFlows = [
    {
      alias: BROWSER_FLOW,
      description: 'An existing session, or a password and, when the mfa level is asked for, a one-time code',
      providerId: 'basic-flow',
      topLevel: true,
      builtIn: false,
      authenticationExecutions: [
        execution({ authenticator: 'auth-cookie', requirement: 'ALTERNATIVE', priority: 10 }),
        subflow('pythagoras sign-in', 'ALTERNATIVE', 20),
      ],
    },
    {
      alias: 'pythagoras sign-in',
      description: 'Each level of sign-in in turn',
      providerId: 'basic-flow',
      topLevel: false,
      builtIn: false,
      authenticationExecutions: [
        subflow('pythagoras password', 'CONDITIONAL', 10),
        subflow('pythagoras second factor', 'CONDITIONAL', 20),
      ],
    },
    {
      alias: 'pythagoras password',
      description: 'Level 1: e-mail address and password',
      providerId: 'basic-flow',
      topLevel: false,
      builtIn: false,
      authenticationExecutions: [
        execution({ authenticator: 'conditional-level-of-authentication', authenticatorConfig: 'level 1', priority: 10 }),
        execution({ authenticator: 'auth-username-password-form', priority: 20 }),
      ],
    },
    {
      alias: 'pythagoras second factor',
      description: 'Level 2: a one-time code from an authenticator app, set up at the first such sign-in',
      providerId: 'basic-flow',
      topLevel: false,
      builtIn: false,
      authenticationExecutions: [
        execution({ authenticator: 'conditional-level-of-authentication', authenticatorConfig: 'level 2', priority: 10 }),
        execution({ authenticator: 'auth-otp-form', priority: 20 }),
      ],
    },
  ];
  realm.authenticatorConfig = [
    { alias: 'level 1', config: { 'loa-condition-level': '1', 'loa-max-age': LEVEL_MAX_AGE } },
    { alias: 'level 2', config: { 'loa-condition-level': '2', 'loa-max-age': LEVEL_MAX_AGE } },
  ];

  realm.smtpServer = {
    host: '${KC_SMTP_HOST}',
    port: '${KC_SMTP_PORT}',
    from: '${KC_SMTP_FROM}',
    fromDisplayName: '${KC_SMTP_FROM_NAME}',
    starttls: '${KC_SMTP_STARTTLS}',
    ssl: '${KC_SMTP_SSL}',
    auth: 'true',
    user: '${KC_SMTP_USER}',
    password: '${KC_SMTP_PASSWORD}',
  };

  realm.clients = realm.clients
    .filter((client) => !DEVELOPMENT_CLIENTS.has(client.clientId))
    .map((client) => {
      if (client.clientId === 'pythagoras-web') {
        return addresses(client, ['${KC_PORTAL_URL}/auth/callback'], '${KC_PORTAL_URL}/*');
      }
      if (client.clientId === 'pythagoras-cms') {
        return addresses(client, ['${KC_CMS_URL}/sso/callback'], '${KC_CMS_URL}/*');
      }
      return client;
    });
  realm.users = realm.users.filter((user) => user.serviceAccountClientId);
  return realm;
}

function execution({ authenticator, authenticatorConfig, requirement = 'REQUIRED', priority }) {
  return {
    authenticator,
    ...(authenticatorConfig ? { authenticatorConfig } : {}),
    authenticatorFlow: false,
    requirement,
    priority,
    userSetupAllowed: false,
  };
}

function subflow(flowAlias, requirement, priority) {
  return { authenticatorFlow: true, flowAlias, requirement, priority, userSetupAllowed: false };
}

function addresses(client, redirectUris, postLogout) {
  return {
    ...client,
    redirectUris,
    attributes: { ...client.attributes, 'post.logout.redirect.uris': postLogout },
  };
}

const render = () => `${JSON.stringify(productionRealm(JSON.parse(readFileSync(source, 'utf8'))), null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      // missing: out of date
    }
    if (current !== render()) {
      console.error('the production realm is out of date: run node infra/keycloak/production-realm.mjs');
      process.exit(1);
    }
    console.log('production realm: up to date');
  } else {
    writeFileSync(target, render());
    console.log(`wrote ${target}`);
  }
}
