/**
 * Unit test setup
 *
 * chrome.storage.local を Promise ベースの in-memory 実装にパッチする。
 *
 * 使い方:
 *   各テストファイルの先頭で
 *     require('./setup');   // または require('../setup');
 *   と書くと、beforeEach/afterEach がそのファイルのテストスイートに登録される。
 *
 * 背景:
 *   jest-webextension-mock は chrome.* のスタブを提供するが、
 *   storage.get/set 間の値の永続化は行わない。
 *   setupFiles での beforeEach は test framework インストール前のため使用不可。
 *   テストファイル内での require() なら beforeEach は global として利用可能。
 */

const _store = {};

beforeEach(() => {
  // テスト間で store をリセット
  Object.keys(_store).forEach(k => delete _store[k]);

  chrome.storage.local.get.mockImplementation((keys, cb) => {
    let result;
    if (keys === null || keys === undefined) {
      result = { ..._store };
    } else if (typeof keys === 'string') {
      result = { [keys]: _store[keys] };
    } else if (Array.isArray(keys)) {
      result = Object.fromEntries(keys.map(k => [k, _store[k]]));
    } else {
      result = Object.fromEntries(
        Object.keys(keys).map(k => [k, _store[k] ?? keys[k]])
      );
    }
    if (cb) cb(result);
    return Promise.resolve(result);
  });

  chrome.storage.local.set.mockImplementation((obj, cb) => {
    Object.assign(_store, obj);
    if (cb) cb();
    return Promise.resolve();
  });

  chrome.storage.local.remove.mockImplementation((keys, cb) => {
    (Array.isArray(keys) ? keys : [keys]).forEach(k => delete _store[k]);
    if (cb) cb();
    return Promise.resolve();
  });

  chrome.storage.local.clear.mockImplementation((cb) => {
    Object.keys(_store).forEach(k => delete _store[k]);
    if (cb) cb();
    return Promise.resolve();
  });

  global.fetch = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
});
