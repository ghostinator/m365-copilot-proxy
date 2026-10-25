import { randomUUID } from "node:crypto";
import { createLogger } from "./log.js";
import type { Message } from "./tools.js";
import { boundedBytes, positiveInt, requestSignal } from "./limits.js";

const log = createLogger("image-input");

// Image input (vision, #39). The web client uploads a pasted image to
// `/m365Copilot/UploadFile`, gets a `docId` back, and points the next chat
// message at it with an `ImageFile` annotation — the same flow Microsoft's PyRIT
// replicates (docs/hypotheses.md H8.10). The upload is keyed to the conversation.
// The chat turn needs nothing else: no GPT-V optionsSets, and the tool agent
// sees the image too (§33 F86).
const UPLOAD_URL = "https://substrate.office.com/m365Copilot/UploadFile";

export interface ImageAnnotation {
  id: string;
  messageAnnotationMetadata: { "@type": "File"; annotationType: "File"; fileType: string; fileName: string };
  messageAnnotationType: "ImageFile";
}

/** Upload one image (a `data:image/...;base64,` URL) and return the annotation
 *  that attaches it to a chat message. */
export async function uploadImage(token: string, conversationId: string, dataUrl: string, signal?: AbortSignal): Promise<ImageAnnotation> {
  if (dataUrl.length > positiveInt(process.env.M365_MAX_IMAGE_BYTES, 20 * 1024 * 1024) * 4 / 3 + 256) throw new Error("Attached image exceeds the configured size limit");
  const type = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(dataUrl)?.[1]?.toLowerCase();
  if (!type) throw new Error("not a base64 image data URL");
  const form = new URLSearchParams({ scenario: "UploadImage", conversationId, FileBase64: dataUrl });
  for (const o of ["cwcgptvsan", "flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch"]) form.append("optionsSets", o);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    signal: requestSignal(signal),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Scenario": "OfficeWebIncludedCopilot",
      "X-Variants": "feature.EnableImageSupportInUploadFile",
      Origin: "https://m365.cloud.microsoft",
      Referer: "https://m365.cloud.microsoft/",
    },
    body: form,
  });
  const body = (await boundedBytes(res, 1024 * 1024)).toString("utf8");
  if (!res.ok) throw new Error(`UploadFile ${res.status}: ${body.slice(0, 200)}`);
  let docId: string | undefined;
  try { docId = JSON.parse(body).docId; } catch {}
  if (!docId) throw new Error(`UploadFile returned no docId: ${body.slice(0, 200)}`);
  const fileType = type === "jpeg" ? "jpg" : type.replace(/\+.*$/, "");
  log.info(`Uploaded ${fileType} image (${dataUrl.length} chars) → docId ${docId}`);
  return {
    id: docId,
    messageAnnotationMetadata: { "@type": "File", annotationType: "File", fileType, fileName: `image-${randomUUID().slice(0, 8)}.${fileType}` },
    messageAnnotationType: "ImageFile",
  };
}

/** The image data URLs in these messages, in order (OpenAI `image_url` parts). */
export function imageUrls(messages: Message[]): string[] {
  return messages.flatMap((m) =>
    Array.isArray(m.content)
      ? m.content.flatMap((p) => (p.type === "image_url" && typeof p.image_url?.url === "string" ? [p.image_url.url] : []))
      : [],
  );
}
