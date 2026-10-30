// Keep this compatibility layer server-only and limited to the binding the
// application uses. Other imports retain Node's normal resolution rules.
const environmentModule = 'data:text/javascript,export const env = process.env;';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') {
    return { url: environmentModule, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
