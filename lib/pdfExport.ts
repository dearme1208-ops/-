import html2canvas from "html2canvas";
import jsPDF from "jspdf";

// 画面上のダッシュボードをそのまま画像として取り込み、PDF化する。
// 日本語フォントの埋め込みが不要になる（ブラウザが描画した文字をそのまま画像として使うため）
export async function exportElementToPdf(element: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#0B0B0C",
    useCORS: true,
  });

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  const imgWidth = usableWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  const pxPerPtY = canvas.height / imgHeight;
  const pageHeightPx = usableHeight * pxPerPtY;

  let renderedPx = 0;
  let pageIndex = 0;
  while (renderedPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeightPx;
    const ctx = pageCanvas.getContext("2d")!;
    ctx.fillStyle = "#0B0B0C";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

    const sliceImg = pageCanvas.toDataURL("image/png");
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(sliceImg, "PNG", margin, margin, imgWidth, sliceHeightPx / pxPerPtY);

    renderedPx += sliceHeightPx;
    pageIndex++;
  }

  pdf.save(filename);
}
