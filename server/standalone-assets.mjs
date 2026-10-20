// Explicit publication manifest. Private generators, source maps and arbitrary
// new files under public/ are never implicitly copied or served by this target.
export const STANDALONE_GAME_ASSETS = Object.freeze([
  'api.js', 'app.js', 'audio.js', 'auth.js', 'avatar.js', 'favicon.svg',
  'game-core.js', 'privacy.js', 'privacy-views.js', 'policy-views.js', 'reminders.js', 'state.js', 'styles.css',
]);
export const STANDALONE_ASSET_PATHS = Object.freeze([
  '/', '/local-boot.js', ...STANDALONE_GAME_ASSETS.map(name => `/game/${name}`),
]);
