// 코트노트 서비스 워커
// 앱을 "홈 화면에 추가"해서 쓸 수 있게 해주는 최소한의 역할만 해요.
// 데이터는 항상 실시간(Firestore)으로 받아오는 앱이라, 여기서는 화면 껍데기만
// 살짝 캐싱해서 오프라인일 때 흰 화면 대신 뭔가는 뜨게 하는 정도로만 써요.
// 새 버전을 배포하면 아래 CACHE_VERSION 값이 바뀌지 않아도 매번 네트워크를
// 우선 시도하기 때문에 최신 코드가 바로 반영돼요 (구버전이 캐시에 갇히지 않아요).

var CACHE_VERSION = 'court-note-v2-coach-isolation';
var SHELL_FILES = ['/', '/index.html', '/manifest.json', '/coach-session.js'];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(SHELL_FILES).catch(function () {
        // 일부 파일이 캐싱 실패해도 설치 자체는 계속 진행
      });
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key.indexOf('court-note-') === 0 && key !== CACHE_VERSION; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  // API 호출이나 Firebase/Firestore 요청은 서비스 워커가 건드리지 않고 그대로 통과시켜요.
  var url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        var resClone = res.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, resClone); });
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('/index.html');
        });
      })
  );
});
