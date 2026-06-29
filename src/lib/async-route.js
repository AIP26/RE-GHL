// Wrapper para que cualquier error async en una ruta vaya al error handler
// global de Express (en vez de crashear el proceso con UnhandledPromiseRejection).
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
