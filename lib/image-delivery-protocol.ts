import {
  describeImageGridLayout,
  getImageGridLayout,
  isImageGridCount,
  type ImageGridCount,
  type ImageGridLayout,
} from "./image-grid-split";

export type ImageReplyPlan =
  | { action: "none" }
  | {
    action: "send_image";
    delivery: "single";
    displayImageCount: 1;
    visualIntent: string;
    fallback: "text_photo";
  }
  | {
    action: "send_image";
    delivery: "group";
    displayImageCount: ImageGridCount;
    visualIntent: string;
    shots: string[];
    characterExpressionStyle: "infer_from_context" | "expressive" | "subtle";
    fallback: "text_photo";
  };

export type ImageExecutionMode = "generated_photo" | "text_photo";

export type ImageGenerationAvailability = {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type MultiImageExpressionStyle = "infer_from_context" | "expressive" | "subtle";

export type MultiImageChatPlan = {
  displayImageCount: ImageGridCount;
  visualIntent: string;
  shots: string[];
  characterExpressionStyle: MultiImageExpressionStyle;
  useReferenceImage: boolean;
};

export const MULTI_IMAGE_TARGET_CELL_ASPECT_RATIO = 0.84;

export function hasUsableImageGenerationConfig(settings: ImageGenerationAvailability): boolean {
  return settings.enabled
    && Boolean(settings.apiKey.trim() && settings.baseUrl.trim() && settings.model.trim());
}

export function shouldHidePendingAssistantImage(params: {
  role: string;
  mediaType?: string;
  imageGenerationStatus?: string;
}): boolean {
  return params.role === "assistant"
    && params.mediaType === "image"
    && params.imageGenerationStatus === "pending";
}

export type MultiImageCanvasGuidance = {
  targetCellAspectRatio: number;
  idealCanvasAspectRatio: number;
  orientation: "portrait" | "landscape" | "square";
};

export type MultiImageGenerationSize = {
  size: string;
  strategy: "configured_preset" | "model_preset" | "prompt_only";
};

export const IMAGE_DELIVERY_DECISION_PROTOCOL = [
  "在输出回复前先在内部完成图片意图判断，不要展示判断过程。",
  "先根据上下文、用户输入、角色性格与记忆判断本次回复是否适合发送图片，不要为了使用能力而强行发图。",
  "若决定发图，判断聊天界面最终应出现几个可独立浏览的媒体对象，而不是计算单张画面内部包含多少区域、主体或时间片段。",
  "一个完整视觉表达应走单图；多个能够各自成立、预期被分别浏览的视觉表达才走多图。不得依赖某个关键词或穷举例外做判断。",
  "只有已经判定为多图后，才从 2、4、6、9 中选择数量，并在生图前为每张照片确定独立内容。",
  "单图沿用用户或生图模型的默认尺寸；多图不得照搬单图固定尺寸，必须根据已确定的数量、行列布局和纵向叠卡目标推导整张接触表的画布方向与尺寸指导。",
  "若没有可用生图模型或生图失败，保持已经确定的单图/多图意图和数量不变，只把每个媒体对象降级为文字图。",
].join("\n");

export function buildImageDeliveryChatPrompt(): string {
  return [
    "### 图片回复决策与输出协议",
    IMAGE_DELIVERY_DECISION_PROTOCOL,
    "不发图时照常回复，不要输出任何图片协议。",
    "单图使用 [照片:使用参考图:可见画面描述] 或 [照片:不使用参考图:可见画面描述]。单图描述只对应一个最终媒体对象。",
    "多图只能输出一个结构化动作，不得用多个单图标签代替：",
    '[多图]{"count":4,"visualIntent":"整组照片共同表达的视觉意图","shots":["第1张独立画面描述","第2张独立画面描述","第3张独立画面描述","第4张独立画面描述"],"useReferenceImage":true,"characterExpressionStyle":"infer_from_context"}[/多图]',
    "多图 JSON 必须单行且可解析；count 只能是 2、4、6、9，shots 数量必须与 count 完全一致，并按最终展示顺序填写。",
    "每个 shot 都要是可以单独浏览的完整画面，围绕共同意图自然变化情境、时刻、视角、构图、动作或状态；禁止复制粘贴同一画面、镜像复用、只做微小局部替换。",
    "人物相关时，先依据角色已有性格和当前情境规划每张内容。活泼外放的角色可用 expressive，鼓励更明显而自然的表情、眼神、嘴型与动作变化；内敛克制的角色可用 subtle，允许变化细微但仍应自然可辨；不确定时使用 infer_from_context。",
    "人物身份连续靠角色概念、脸型与核心五官保持，不要把同一张脸、同一表情和同一姿势机械复制到所有画面。非人物内容则根据主题变化观察角度、距离、状态、环境或时间，不套用人物表情要求。",
    "useReferenceImage 只表示本次生成是否使用角色参考图；不要因为系统之后可能降级为文字图而改变是否发图、单图或多图的判断。",
  ].join("\n");
}

export function createMultiImageCanvasGuidance(layout: ImageGridLayout): MultiImageCanvasGuidance {
  const idealCanvasAspectRatio = MULTI_IMAGE_TARGET_CELL_ASPECT_RATIO * layout.cols / layout.rows;
  const orientation = idealCanvasAspectRatio > 1.05
    ? "landscape"
    : idealCanvasAspectRatio < 0.95
      ? "portrait"
      : "square";
  return {
    targetCellAspectRatio: MULTI_IMAGE_TARGET_CELL_ASPECT_RATIO,
    idealCanvasAspectRatio,
    orientation,
  };
}

function parseImageSize(value: string): { width: number; height: number } | null {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function orientImageSize(shortEdge: number, longEdge: number, orientation: MultiImageCanvasGuidance["orientation"]): string {
  if (orientation === "landscape") return `${longEdge}x${shortEdge}`;
  if (orientation === "portrait") return `${shortEdge}x${longEdge}`;
  return `${shortEdge}x${shortEdge}`;
}

export function resolveMultiImageGenerationSize(
  guidance: MultiImageCanvasGuidance,
  options: { model?: string; configuredSize?: string },
): MultiImageGenerationSize {
  const configuredSize = options.configuredSize?.trim() || "auto";
  const parsed = parseImageSize(configuredSize);
  if (parsed && parsed.width !== parsed.height) {
    return {
      size: orientImageSize(Math.min(parsed.width, parsed.height), Math.max(parsed.width, parsed.height), guidance.orientation),
      strategy: "configured_preset",
    };
  }

  const model = options.model?.toLowerCase() || "";
  if (/dall[-_.\s]?e[-_.\s]?3|dalle[-_.\s]?3/.test(model)) {
    return { size: orientImageSize(1024, 1792, guidance.orientation), strategy: "model_preset" };
  }
  if (/gpt[-_.\s]?image|chatgpt[-_.\s]?image/.test(model)) {
    return { size: orientImageSize(1024, 1536, guidance.orientation), strategy: "model_preset" };
  }

  return { size: configuredSize, strategy: "prompt_only" };
}

export function resolveImageExecutionMode(hasUsableImageModel: boolean): ImageExecutionMode {
  return hasUsableImageModel ? "generated_photo" : "text_photo";
}

export function createPhotoGroupPlan(
  displayImageCount: ImageGridCount,
  visualIntent: string,
  shots: string[] = [],
  characterExpressionStyle: MultiImageExpressionStyle = "infer_from_context",
): Extract<ImageReplyPlan, { delivery: "group" }> {
  if (!isImageGridCount(displayImageCount)) {
    throw new Error("多图数量只支持 2、4、6、9");
  }
  const normalizedShots = shots.map(shot => shot.trim()).filter(Boolean);
  if (normalizedShots.length > 0 && normalizedShots.length !== displayImageCount) {
    throw new Error(`照片计划数量应为 ${displayImageCount}，当前为 ${normalizedShots.length}`);
  }
  return {
    action: "send_image",
    delivery: "group",
    displayImageCount,
    visualIntent: visualIntent.trim(),
    shots: normalizedShots,
    characterExpressionStyle,
    fallback: "text_photo",
  };
}

export function buildMultiImageSheetPrompt(plan: Extract<ImageReplyPlan, { delivery: "group" }>): {
  layout: ImageGridLayout;
  canvasGuidance: MultiImageCanvasGuidance;
  prompt: string;
} {
  const layout = getImageGridLayout(plan.displayImageCount);
  if (!layout) throw new Error("当前多图数量没有固定布局");
  const canvasGuidance = createMultiImageCanvasGuidance(layout);
  const orientationText = canvasGuidance.orientation === "landscape" ? "横向" : canvasGuidance.orientation === "portrait" ? "纵向" : "方形";
  const shotPlan = plan.shots.length === plan.displayImageCount
    ? ["各格内容按从左到右、从上到下依次为：", ...plan.shots.map((shot, index) => `${index + 1}. ${shot}`)]
    : ["渲染前先在内部规划每一格的独立内容；各格共同服务于本次意图，但不能成为同一画面的复制品或局部替换版。"];
  const expressionGuidance = plan.characterExpressionStyle === "expressive"
    ? "人物性格偏活泼外放：在不改变身份的前提下，鼓励更丰富、自然且明显不同的表情、眼神、嘴型和肢体动作。"
    : plan.characterExpressionStyle === "subtle"
      ? "人物性格偏内敛克制：不强迫夸张表演，允许表情变化细微，但各格的眼神、嘴角、情绪或动作应能看出自然区别。"
      : "生图前先根据本次视觉意图判断人物的性格与情境：活泼外放的人物鼓励更丰富的表情和动作变化；内敛克制的人物保持自然细微变化，不强迫夸张表演。";

  return {
    layout,
    canvasGuidance,
    prompt: [
      `生成一张用于程序切割的照片接触表。整张画布严格分为 ${layout.rows} 行，每行 ${layout.cols} 张，共 ${plan.displayImageCount} 个等大的独立画面。`,
      `固定布局：${describeImageGridLayout(layout)}。这里的“行”是从上到下，“列”是从左到右；不得交换行列，不得使用其他排列。`,
      `尺寸指导仅用于本次多图：每个格子最终会作为上下方向较长的纵向照片，目标宽高比约为 ${canvasGuidance.targetCellAspectRatio.toFixed(2)}:1（宽:高）；整张接触表应采用${orientationText}画布，理想宽高比约为 ${canvasGuidance.idealCanvasAspectRatio.toFixed(2)}:1。`,
      "不同接口的画布预设可能不完全一致。无论实际画布尺寸如何，每格都按纵向照片安排主体和关键动作，重要内容避开四周切割安全区，背景继续铺满格子；程序会在切割后统一为纵向比例。",
      "本次已经确定要展示多张可独立浏览的照片。每个格子只能包含一张完整照片，格子内部不得再出现拼贴、分镜、小窗或二次网格。",
      ...shotPlan,
      "如果主体是人物：保持这是同一个角色及其可辨识的脸型与核心五官，身份连续程度适中，不要把同一张脸复制到所有格子。每格应有符合场景的不同表情、眼神或嘴型，并在动作、视角、构图或情境中至少再变化一项。",
      expressionGuidance,
      "如果主体不是人物：保持核心主题连续，并依据内容自然变化观察角度、距离、时刻、状态或环境；不要套用人物表情规则。",
      "变化必须服务于实际内容，不要为了制造差异机械地同时更换所有元素。禁止镜像复制、重复姿势、重复构图和只替换局部细节。",
      "每个画面必须完整且只属于自己的格子，人物和物体不得跨格。不要标题、文字、编号、外框、圆角或装饰性分隔线。格子之间不要留白、边距或沟槽，画面必须铺满各自格子直到切割线。",
      `本次视觉意图：${plan.visualIntent}`,
    ].join("\n"),
  };
}
