/**
 * SVG text measurement utility.
 * Creates a hidden SVG element for accurate text width/height measurement.
 * Ported from webapp-frontend/src/helpers/svg-measurer.js
 */

let svgMeasureRoot: SVGSVGElement | null = null;
let svgTextNode: SVGTextElement | null = null;

export default function getSvgMeasurer(): {
  svgMeasureRoot: SVGSVGElement;
  svgTextNode: SVGTextElement;
} {
  if (svgMeasureRoot && svgTextNode) {
    return { svgMeasureRoot, svgTextNode };
  }

  svgMeasureRoot = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );

  svgMeasureRoot.setAttribute("width", "0");
  svgMeasureRoot.setAttribute("height", "0");
  svgMeasureRoot.setAttribute("xml:space", "preserve");
  svgMeasureRoot.style.position = "absolute";
  svgMeasureRoot.style.visibility = "hidden";
  svgMeasureRoot.style.top = "-9999px";

  svgTextNode = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text"
  );

  svgMeasureRoot.appendChild(svgTextNode);
  document.body.appendChild(svgMeasureRoot);

  return { svgMeasureRoot, svgTextNode };
}
