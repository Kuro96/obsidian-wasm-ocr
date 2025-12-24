export async function decodeImage(buffer: ArrayBuffer): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer]);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get 2D context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to decode image'));
    };
    img.src = URL.createObjectURL(blob);
  });
}
