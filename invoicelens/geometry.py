from dataclasses import dataclass

import numpy as np

from .models import Box, Page, Word


@dataclass
class Row:
    words: list[Word]
    page: int

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    @property
    def bbox(self) -> Box:
        return union(self.words)


def union(words: list[Word]) -> Box:
    return Box(x0=min(w.bbox.x0 for w in words), y0=min(w.bbox.y0 for w in words),
               x1=max(w.bbox.x1 for w in words), y1=max(w.bbox.y1 for w in words))


def group_rows(page: Page) -> list[Row]:
    """Cluster by vertical centers using a tolerance relative to glyph height."""
    if not page.words:
        return []
    height = float(np.median([w.bbox.y1 - w.bbox.y0 for w in page.words]))
    tolerance = max(2.0, height * 0.48)
    clusters: list[list[Word]] = []
    centers: list[float] = []
    for word in sorted(page.words, key=lambda w: ((w.bbox.y0 + w.bbox.y1) / 2, w.bbox.x0)):
        center = (word.bbox.y0 + word.bbox.y1) / 2
        if clusters and abs(center - centers[-1]) <= tolerance:
            clusters[-1].append(word)
            centers[-1] = float(np.median([(w.bbox.y0 + w.bbox.y1) / 2 for w in clusters[-1]]))
        else:
            clusters.append([word])
            centers.append(center)
    return [Row(sorted(words, key=lambda w: w.bbox.x0), page.number) for words in clusters]


def cluster_right_edges(words: list[Word], tolerance: float) -> list[list[Word]]:
    clusters: list[list[Word]] = []
    for word in sorted(words, key=lambda w: w.bbox.x1):
        if clusters and abs(word.bbox.x1 - float(np.median([w.bbox.x1 for w in clusters[-1]]))) <= tolerance:
            clusters[-1].append(word)
        else:
            clusters.append([word])
    return clusters

