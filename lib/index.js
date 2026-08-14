/**
 * dsh-skin-glass — host half.
 *
 * The glass skin is browser-presentation state (background image + blur),
 * persisted by the browser half in localStorage: the settings wire boundary
 * only exposes the product's hardcoded namespace allowlist, so a third-party
 * namespace cannot be written from the browser. This host entry exists so
 * the profile loader can resolve the bundle; it registers nothing.
 */
function apply() {}

export { apply };
