/**
 * dsh-skin-glass — host half.
 *
 * Registers the durable settings namespace owned by the skin (background
 * image data URL + frosted-glass blur strength). The browser half reads and
 * writes this section through `ctx.settingsScope`; the loader requires this
 * host entry to exist for the bundle to mount.
 */
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";

/** Settings namespace owned by the glass skin plugin. */
const GLASS_SETTINGS_NAMESPACE = "dsh-skin-glass";
/** Namespace key accepted by the settings provider registry. */
const GLASS_SETTINGS_NAMESPACE_KEY = settingsNamespace(GLASS_SETTINGS_NAMESPACE);

/**
 * Durable glass-skin schema: the background image as a (client-downscaled)
 * data URL plus the frosted blur radius in px.
 */
const GlassSettingsSchema = z.object({
  image: z.string().default(""),
  blur: z.number().min(0).max(64).default(24)
});

/**
 * Register the section when the Host settings service is composed.
 * @param ctx - Host context that may acquire the settings service.
 */
function apply(ctx) {
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.register(GLASS_SETTINGS_NAMESPACE_KEY, GlassSettingsSchema);
  });
}

export { GlassSettingsSchema, GLASS_SETTINGS_NAMESPACE, apply };
