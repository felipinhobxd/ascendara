const assert = require("node:assert/strict");
const test = require("node:test");

const helperPath = require.resolve("./auth-helper");

function loadFreshAuthHelper(secretSeed) {
  if (secretSeed) process.env.ASCENDARA_SECRET_SEED = secretSeed;
  else delete process.env.ASCENDARA_SECRET_SEED;

  delete require.cache[helperPath];
  return require("./auth-helper");
}

test("source builds load without the private production config", () => {
  const previousSeed = process.env.ASCENDARA_SECRET_SEED;

  try {
    const authHelper = loadFreshAuthHelper(null);
    const headers = authHelper.generateAuthHeaders();

    assert.equal(headers["X-Timestamp"], undefined);
    assert.equal(headers["X-Signature"], undefined);
  } finally {
    if (previousSeed === undefined) delete process.env.ASCENDARA_SECRET_SEED;
    else process.env.ASCENDARA_SECRET_SEED = previousSeed;
    delete require.cache[helperPath];
  }
});

test("official or explicitly configured builds keep HMAC authentication", () => {
  const previousSeed = process.env.ASCENDARA_SECRET_SEED;

  try {
    const authHelper = loadFreshAuthHelper("ascendara-test-secret");
    const headers = authHelper.generateAuthHeaders();

    assert.match(headers["X-Timestamp"], /^\d+$/);
    assert.match(headers["X-Signature"], /^[a-f0-9]{64}$/);
  } finally {
    if (previousSeed === undefined) delete process.env.ASCENDARA_SECRET_SEED;
    else process.env.ASCENDARA_SECRET_SEED = previousSeed;
    delete require.cache[helperPath];
  }
});
