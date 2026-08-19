export const NVIDIA_BUILD_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_DIFFUSION_GEMMA_MODEL = "google/diffusiongemma-26b-a4b-it";

/**
 * DiffusionGemma uses NVIDIA's chat-template extension for reasoning control.
 * Deliberately contains no tools/tool_choice fields: this provider is text-only
 * in the pipeline and consumes search results produced by another provider.
 */
export function nvidiaChatOptions(thinking: boolean) {
  return {
    chat_template_kwargs: {
      enable_thinking: thinking,
    },
  };
}
