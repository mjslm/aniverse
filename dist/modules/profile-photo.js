export const maxPhotoBytes = 5 * 1024 * 1024;

export function validateProfilePhoto(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (!file.size || file.size > maxPhotoBytes) throw new Error("Choose an image smaller than 5 MB.");
}

export function storedProfilePhoto(value) {
  return typeof value === "string" && value.length < 180000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : "";
}

export async function createProfilePhoto(file) {
  validateProfilePhoto(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("This image could not be opened.");
    // Crop and resize photos before keeping them on this device.
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    context.fillStyle = "#1a1b21";
    context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
