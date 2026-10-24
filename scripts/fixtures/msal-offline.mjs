export class PublicClientApplication {
  getTokenCache() { return { deserialize() {}, serialize: () => "{}", getAllAccounts: async () => [{ username: "offline-fixture" }] }; }
  async acquireTokenSilent() {
    const claims = { aud: "offline", iss: "offline", oid: "offline", tid: "offline", exp: Math.floor(Date.now() / 1000) + 3600 };
    return { accessToken: `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x` };
  }
}
