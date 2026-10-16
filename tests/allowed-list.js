// The family list (allowed/{email}) for emulator tests: test users sign in as <uid>@example.com.
// The rules only let people in when their email has a doc in `allowed`.
const F = require("firebase/firestore");

const emailOf = uid => `${uid}@example.com`;

// Signed in as uid, with a verified Google email like the real app
const asUser = (env, uid) =>
  env.authenticatedContext(uid, { email: emailOf(uid), email_verified: true }).firestore();

// Put these users on the family list (rules off, like Darren adding them in the Firebase console)
async function allow(env, uids) {
  await env.withSecurityRulesDisabled(async ctx => {
    for (const uid of uids) await F.setDoc(F.doc(ctx.firestore(), "allowed", emailOf(uid)), { note: "test" });
  });
}

// Same, for the browser checks that use the emulator's REST API (owner token skips the rules)
async function allowRest(uids, project = "demo-food-tracker") {
  for (const uid of uids) {
    const url = `http://127.0.0.1:8085/v1/projects/${project}/databases/(default)/documents/allowed?documentId=${encodeURIComponent(emailOf(uid))}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer owner", "content-type": "application/json" },
      body: JSON.stringify({ fields: { note: { stringValue: "test" } } }),
    });
    if (!res.ok) throw new Error(`allow ${uid}: ${res.status} ${await res.text()}`);
  }
}

module.exports = { emailOf, asUser, allow, allowRest };
