export function operatorRoutes({ router, operatorAuth }) {
  const guarded = (register) => (path, handler) => {
    if (!operatorAuth) return;
    register(path, operatorAuth.webAuthMw, operatorAuth.adminMw, handler);
  };
  return {
    get: guarded(router.get.bind(router)),
    post: guarded(router.post.bind(router)),
  };
}
