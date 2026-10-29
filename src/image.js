// Подготовка картинок в браузере перед загрузкой: уменьшаем через canvas и кодируем в JPEG.
// Исходный файл на сервер не уходит никогда — перекодирование заодно стирает EXIF/GPS.

const QUALITY = 0.85;

async function decode(file) {
  // imageOrientation: 'from-image' — учесть поворот из EXIF (фото с телефона), дальше метаданных уже нет.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// mode 'fit': длинная сторона не больше size (без увеличения); mode 'square': квадрат size×size с обрезкой по центру.
export async function prepareImage(file, { size, mode }) {
  let src;
  try {
    src = await decode(file);
  } catch {
    throw { message: 'Не удалось прочитать картинку. Выберите другое фото (JPEG, PNG или WebP).' };
  }
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  if (!w || !h) throw { message: 'Не удалось прочитать картинку. Выберите другое фото.' };

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (mode === 'square') {
    const side = Math.min(w, h);
    canvas.width = canvas.height = size;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  } else {
    const k = Math.min(1, size / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    ctx.fillStyle = '#fff'; // у JPEG нет прозрачности
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  }
  src.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  canvas.width = canvas.height = 0;
  if (!blob || blob.type !== 'image/jpeg') throw { message: 'Не удалось обработать картинку. Попробуйте другое фото.' };
  return blob;
}

export const prepareDrinkPhoto = (file) => prepareImage(file, { size: 1000, mode: 'fit' });
export const prepareAvatar = (file) => prepareImage(file, { size: 256, mode: 'square' });
