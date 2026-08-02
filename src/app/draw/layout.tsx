import type { Metadata } from "next";

/**
 * A layout that exists only to carry metadata.
 *
 * `page.tsx` is a client component — it is a drawing program, all of it is
 * interaction — and a client component cannot export `metadata`. This is the
 * standard way round that: a server layout wrapping it, adding nothing to the
 * tree but the title the tab and the share card need.
 */
export const metadata: Metadata = {
  title: "FOURFOLD — Symmetry Draw",
  description:
    "A drawing program whose brush is a symmetry. Paint one cell and it paints the whole orbit under the subgroup you chose; orbit position k takes the colour scheme's k-th hue, so the drawing's colour structure is its symmetry structure.",
  openGraph: {
    title: "FOURFOLD — Symmetry Draw",
    description:
      "Paint one cell and the brush paints its whole orbit. The colour structure of the drawing is its symmetry structure.",
    type: "website",
  },
};

export default function DrawLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
