import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  useAnalysisStore,
  SelectionAnchor,
  AnalysisItem,
} from '../models/store';
import { Notice } from 'obsidian';
import { ChevronLeft, ChevronRight, RotateCcw, Clipboard } from 'lucide-react';

export const ImagePreview: React.FC = () => {
  const {
    items,
    currentIndex,
    setCurrentIndex,
    nextImage,
    prevImage,
    toggleSelection,
    setSelection,
    setActiveRange,
    clearSelection,
    selectedIndices,
    activeRange,
    setItems,
  } = useAnalysisStore();

  const currentItem = items[currentIndex];
  const imageUrl = currentItem?.url;
  const ocrResults = currentItem?.ocrResults;

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1); // Native image scale (screen / natural)

  // Pan & Zoom State
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Animation State
  const [animClass, setAnimClass] = useState('');
  const prevIndexRef = useRef(currentIndex);

  // Selection state
  const [isDragging, setIsDragging] = useState(false);
  const [selectionMode, setSelectionMode] = useState<
    'marquee' | 'range' | null
  >(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragCurrent, setDragCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [rangeAnchor, setRangeAnchor] = useState<SelectionAnchor | null>(null);
  const selectionSnapshot = useRef<number[]>([]);

  const progressBarRef = useRef<HTMLDivElement>(null);

  const handlePaste = useCallback(
    async (e?: React.ClipboardEvent | ClipboardEvent) => {
      try {
        let blob: Blob | null = null;

        // 1. Try Event Data (Synchronous, fast)
        if (e && e.clipboardData) {
          for (const item of Array.from(e.clipboardData.items)) {
            if (item.type.startsWith('image/')) {
              blob = item.getAsFile();
              break;
            }
          }
        }

        // 2. Try Navigator API (Async, fallback)
        if (!blob) {
          const clipboardItems = await navigator.clipboard.read();
          for (const item of clipboardItems) {
            const imageType = item.types.find((type) =>
              type.startsWith('image/'),
            );
            if (imageType) {
              blob = await item.getType(imageType);
              break;
            }
          }
        }

        if (blob) {
          const url = URL.createObjectURL(blob);
          const newItem: AnalysisItem = {
            id: url,
            file: null,
            url: url,
            status: 'pending',
            ocrResults: null,
            error: null,
          };
          // Adding to store will trigger main.ts subscription -> processQueue
          setItems([newItem]);
          new Notice('Image pasted from clipboard');
        } else {
          // Only show notice if we explicitly called this (e.g. button click)
          // or if it was a paste event that didn't contain an image.
          // However, for global paste, we might not want to spam notices if user pastes text.
          // Let's refine this check.
          // For now, keep original behavior but maybe we should check if 'e' exists.
          if (!e) new Notice('No image found in clipboard');
        }
      } catch (err) {
        console.error(err);
        new Notice('Failed to read clipboard');
      }
    },
    [setItems],
  );

  // --- Global Paste Listener ---
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // 1. Check if component is mounted and visible
      // Note: We use containerRef.current.offsetParent to check visibility.
      // This works because if a parent is display:none, offsetParent is null.
      if (!containerRef.current || !containerRef.current.offsetParent) return;

      // 2. Check if focus is in an input/textarea (don't steal from editor)
      // This prevents the plugin from intercepting paste when the user is typing in a note.
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }

      handlePaste(e);
    };

    document.addEventListener('paste', handleGlobalPaste);
    return () => {
      document.removeEventListener('paste', handleGlobalPaste);
    };
  }, [handlePaste]);

  // --- Global Scrubbing Logic ---
  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent) => {
      if (isScrubbing && progressBarRef.current) {
        const rect = progressBarRef.current.getBoundingClientRect();
        const ratio = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left) / rect.width),
        );
        const idx = Math.floor(ratio * items.length);
        if (idx >= 0 && idx < items.length && idx !== currentIndex) {
          setCurrentIndex(idx);
        }
      }
    };

    const handleGlobalUp = () => {
      if (isScrubbing) {
        setIsScrubbing(false);
      }
    };

    if (isScrubbing) {
      window.addEventListener('mousemove', handleGlobalMove);
      window.addEventListener('mouseup', handleGlobalUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
    };
  }, [isScrubbing, items.length, currentIndex]);

  // Reset View on Image Change
  useEffect(() => {
    if (currentIndex !== prevIndexRef.current) {
      const dir = currentIndex > prevIndexRef.current ? 'right' : 'left';
      setAnimClass(dir === 'right' ? 'slide-in-right' : 'slide-in-left');
      prevIndexRef.current = currentIndex;

      const timer = setTimeout(() => setAnimClass(''), 300);

      // Reset Zoom/Pan
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setIsLoaded(false);

      return () => clearTimeout(timer);
    }
  }, [currentIndex]);

  useEffect(() => {
    const updateScale = () => {
      if (imgRef.current) {
        // Initial fit-to-width
        // We acturally rely on zoom=1 being fit-to-width of the container?
        // Or scale being the ratio between rendered px and natural px.
        const naturalWidth = imgRef.current.naturalWidth;
        const clientWidth = imgRef.current.clientWidth;
        if (naturalWidth > 0) {
          // When Zoom=1, image width = container width.
          // Scale is purely for coordinate mapping from Natural -> Screen (at Zoom 1).
          // Actually, if we use transform scale, imgRef.current.clientWidth might change?
          // Let's use natural width as base.
          // ScreenX = NaturalX * (ContainerW / NaturalW) * Zoom + OffsetX
          // Scale = ContainerW / NaturalW
          // But ContainerW varies.
          // Let's simplified:
          // We just need Scale to map Natural Coordinates to "Base Display Coordinates".
        }
      }
    };
    // We don't really need to track scale via ResizeObserver if we handle layout via CSS transform
    // But we need 'scale' for getHitInfo to map Box(Natural) -> Screen.
  }, [imageUrl]);

  const handleLoad = () => {
    if (imgRef.current && containerRef.current) {
      setIsLoaded(true);
      // Reset to fit width
      const contW = containerRef.current.clientWidth;
      const contH = containerRef.current.clientHeight;
      const natW = imgRef.current.naturalWidth;
      const natH = imgRef.current.naturalHeight;

      if (natW > 0) {
        const newScale = contW / natW;
        setScale(newScale);

        // Center Vertically
        const scaledH = natH * newScale;
        if (scaledH < contH) {
          setOffset({ x: 0, y: (contH - scaledH) / 2 });
        } else {
          setOffset({ x: 0, y: 0 });
        }
      }
    }
  };

  // --- Coordinate Mapping ---
  // Screen (Mouse) -> Image (Natural)
  // MouseX = (NaturalX * scale * zoom) + offsetX
  // NaturalX = (MouseX - offsetX) / (scale * zoom)

  const getHitInfo = (
    mouseX: number,
    mouseY: number,
  ): { index: number; charIndex: number } | null => {
    if (!ocrResults) return null;

    // Transform Mouse -> Natural
    // Note: 'scale' variable is derived from img.clientWidth / naturalWidth.
    // If we transform the image using CSS transform: scale(zoom), clientWidth might reflect that?
    // Let's rely on standard logic:
    // displayedWidth = naturalWidth * baseScale * zoom.

    // To simplify: we will use `scale` as the "Fit to Width" ratio.
    // And Zoom applies on top.

    const effScale = scale * zoom;

    for (let i = ocrResults.length - 1; i >= 0; i--) {
      const item = ocrResults[i];

      // Box points in Natural Coords
      const xs = item.box.map((p) => p[0]);
      const ys = item.box.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      // Convert Bounds to Screen Coords
      const sMinX = minX * effScale + offset.x;
      const sMaxX = maxX * effScale + offset.x;
      const sMinY = minY * effScale + offset.y;
      const sMaxY = maxY * effScale + offset.y;

      if (
        mouseX >= sMinX &&
        mouseX <= sMaxX &&
        mouseY >= sMinY &&
        mouseY <= sMaxY
      ) {
        const width = sMaxX - sMinX;
        const height = sMaxY - sMinY;
        const textLen = item.text.length;
        let charIndex = 0;

        if (textLen > 0) {
          if (width >= height) {
            const ratio = Math.max(0, Math.min(1, (mouseX - sMinX) / width));
            charIndex = Math.min(Math.floor(ratio * textLen), textLen - 1);
          } else {
            const ratio = Math.max(0, Math.min(1, (mouseY - sMinY) / height));
            charIndex = Math.min(Math.floor(ratio * textLen), textLen - 1);
          }
        }
        return { index: i, charIndex };
      }
    }
    return null;
  };

  // --- Interaction Logic (Mouse) ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    containerRef.current.focus({ preventScroll: true });

    //kv Middle Click -> Pan
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Left Click -> Selection
    if (e.button === 0) {
      // Always start tracking drag
      setIsDragging(true);
      setDragStart({ x, y });
      setDragCurrent({ x, y });
      setSelectionMode(null);
      setRangeAnchor(null);
      selectionSnapshot.current = [...selectedIndices];
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    // Pan Logic
    if (isPanning && panStart.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      panStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!ocrResults) return;

    const rect = containerRef.current.getBoundingClientRect();
    // Clamp coordinates for selection logic
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const hit = getHitInfo(x, y);
    containerRef.current.style.cursor = isPanning
      ? 'grabbing'
      : hit
        ? 'text'
        : 'default';

    if (!isDragging || !dragStart) return;
    setDragCurrent({ x, y });

    const dist = Math.hypot(x - dragStart.x, y - dragStart.y);

    if (selectionMode === null && dist > 5) {
      const startHit = getHitInfo(dragStart.x, dragStart.y);

      if (startHit && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        setSelectionMode('range');
        const anchor = {
          boxIndex: startHit.index,
          charIndex: startHit.charIndex,
        };
        setRangeAnchor(anchor);
        setActiveRange({ start: anchor, end: anchor });
      } else if (e.ctrlKey || e.metaKey || e.shiftKey) {
        setSelectionMode('marquee');
      }
    }

    if (selectionMode === 'range' && rangeAnchor) {
      if (hit) {
        const endAnchor = { boxIndex: hit.index, charIndex: hit.charIndex };
        setActiveRange({ start: rangeAnchor, end: endAnchor });
      }
    }

    if (selectionMode === 'marquee') {
      const x1 = Math.min(dragStart.x, x);
      const y1 = Math.min(dragStart.y, y);
      const x2 = Math.max(dragStart.x, x);
      const y2 = Math.max(dragStart.y, y);

      // Find intersecting boxes (Screen Coords)
      const currentIntersections: number[] = [];
      const effScale = scale * zoom;

      ocrResults.forEach((item, idx) => {
        const xs = item.box.map((p) => p[0]);
        const ys = item.box.map((p) => p[1]);
        // Convert to Screen
        const bMinX = Math.min(...xs) * effScale + offset.x;
        const bMaxX = Math.max(...xs) * effScale + offset.x;
        const bMinY = Math.min(...ys) * effScale + offset.y;
        const bMaxY = Math.max(...ys) * effScale + offset.y;

        const overlap = !(bMaxX < x1 || bMinX > x2 || bMaxY < y1 || bMinY > y2);
        if (overlap) {
          currentIntersections.push(idx);
        }
      });

      if (e.shiftKey) {
        const toRemove = new Set(currentIntersections);
        const res = selectionSnapshot.current.filter((i) => !toRemove.has(i));
        setSelection(res);
      } else if (e.ctrlKey || e.metaKey) {
        const merged = new Set([
          ...selectionSnapshot.current,
          ...currentIntersections,
        ]);
        setSelection(Array.from(merged));
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
      panStart.current = null;
      return;
    }

    if (!isDragging) return;

    if (selectionMode === null && dragStart) {
      const dist = Math.hypot(
        (dragCurrent?.x ?? dragStart.x) - dragStart.x,
        (dragCurrent?.y ?? dragStart.y) - dragStart.y,
      );

      if (dist < 5) {
        const hit = getHitInfo(dragStart.x, dragStart.y);
        if (hit) {
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            toggleSelection(hit.index, true);
          } else {
            clearSelection();
          }
        } else {
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            clearSelection();
          }
        }
      }
    }

    setIsDragging(false);
    setSelectionMode(null);
    setDragStart(null);
    setRangeAnchor(null);
  };

  // --- Zoom Logic (Wheel) ---
  const handleWheel = (e: React.WheelEvent) => {
    // Zoom
    e.stopPropagation();
    // e.preventDefault(); // React synthetic events can't prevent default on wheel easily for native scrolling, but we are in overflow: hidden

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    // Zoom relative to Canvas Center
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Zoom factor
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    let newZoom = zoom * delta;

    // Clamp Zoom
    newZoom = Math.max(0.1, Math.min(10, newZoom));

    // Adjust offset to keep center fixed
    // (centerX - offsetX) / zoom = (centerX - newOffsetX) / newZoom
    // newOffsetX = centerX - (centerX - offset.x) * (newZoom / zoom)
    const newOffsetX = centerX - (centerX - offset.x) * (newZoom / zoom);
    const newOffsetY = centerY - (centerY - offset.y) * (newZoom / zoom);

    setZoom(newZoom);
    setOffset({ x: newOffsetX, y: newOffsetY });
  };

  const resetView = () => {
    setZoom(1);
    if (imgRef.current && containerRef.current) {
      const contW = containerRef.current.clientWidth;
      const contH = containerRef.current.clientHeight;
      const natW = imgRef.current.naturalWidth;
      const natH = imgRef.current.naturalHeight;

      if (natW > 0) {
        const newScale = contW / natW;
        setScale(newScale);
        const scaledH = natH * newScale;
        setOffset({ x: 0, y: scaledH < contH ? (contH - scaledH) / 2 : 0 });
      } else {
        setOffset({ x: 0, y: 0 });
      }
    } else {
      setOffset({ x: 0, y: 0 });
    }
  };

  // --- Keyboard Shortcuts ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Navigation (Left/Right Arrows)
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevImage();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextImage();
      return;
    }

    const isMod = e.ctrlKey || e.metaKey;

    // Copy (Ctrl+C / Cmd+C)
    if (isMod && e.key === 'c') {
      e.preventDefault();

      let text = '';

      if (activeRange && ocrResults) {
        const { start, end } = activeRange;
        let first = start;
        let last = end;

        if (
          first.boxIndex > last.boxIndex ||
          (first.boxIndex === last.boxIndex && first.charIndex > last.charIndex)
        ) {
          first = end;
          last = start;
        }

        for (let i = first.boxIndex; i <= last.boxIndex; i++) {
          const itemText = ocrResults[i].text;
          let part = itemText;

          if (i === first.boxIndex && i === last.boxIndex) {
            const s = Math.min(first.charIndex, last.charIndex);
            const e = Math.max(first.charIndex, last.charIndex);
            part = itemText.substring(s, e + 1);
          } else if (i === first.boxIndex) {
            part = itemText.substring(first.charIndex);
          } else if (i === last.boxIndex) {
            part = itemText.substring(0, last.charIndex + 1);
          }

          text += (text ? ' ' : '') + part;
        }
      } else if (selectedIndices.length > 0 && ocrResults) {
        const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
        text = sortedIndices.map((i) => ocrResults[i].text).join(' ');
      }

      if (text) {
        navigator.clipboard.writeText(text);
        new Notice('Copied text');
      }
    }

    // Select All (Ctrl+A / Cmd+A)
    if (isMod && e.key === 'a') {
      e.preventDefault();
      if (ocrResults && ocrResults.length > 0) {
        const allIndices = ocrResults.map((_, i) => i);
        setSelection(allIndices);
        new Notice('Selected all text blocks');
      }
    }
  };

  // --- Render Logic ---
  const renderHighlights = () => {
    if (!ocrResults) return null;

    // Render relative to CONTAINER, not IMAGE.
    // We apply transform manually to each box.

    const effScale = scale * zoom;

    return ocrResults.map((item, idx) => {
      // Natural Coords
      const xs = item.box.map((p) => p[0]);
      const ys = item.box.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      // Screen Coords
      const sLeft = minX * effScale + offset.x;
      const sTop = minY * effScale + offset.y;
      const sWidth = (maxX - minX) * effScale;
      const sHeight = (maxY - minY) * effScale;

      const isBoxSelected = selectedIndices.includes(idx);

      let highlightStyle: React.CSSProperties = {
        position: 'absolute',
        left: sLeft,
        top: sTop,
        width: sWidth,
        height: sHeight,
        border: '1px solid rgba(150,150,150,0.3)',
        transition: 'none', // Disable transition for smooth zooming
        zIndex: 10,
        pointerEvents: 'none',
      };

      let partial: React.ReactNode = null;

      if (activeRange) {
        const { start, end } = activeRange;
        let first = start;
        let last = end;
        if (
          first.boxIndex > last.boxIndex ||
          (first.boxIndex === last.boxIndex && first.charIndex > last.charIndex)
        ) {
          first = end;
          last = start;
        }

        if (idx >= first.boxIndex && idx <= last.boxIndex) {
          highlightStyle.border = '2px solid var(--interactive-accent)';

          let startChar = 0;
          let endChar = item.text.length - 1;

          if (idx === first.boxIndex) startChar = first.charIndex;
          if (idx === last.boxIndex) endChar = last.charIndex;

          const localS = Math.min(startChar, endChar);
          const localE = Math.max(startChar, endChar);

          if (localS <= localE) {
            const count = localE - localS + 1;
            const charLen = item.text.length || 1;
            const isHorizontal = sWidth >= sHeight;

            let hlLeft = 0;
            let hlTop = 0;
            let hlW = 0;
            let hlH = 0;

            if (isHorizontal) {
              const charW = sWidth / charLen;
              hlLeft = sLeft + localS * charW;
              hlTop = sTop;
              hlW = count * charW;
              hlH = sHeight;
            } else {
              const charH = sHeight / charLen;
              hlLeft = sLeft;
              hlTop = sTop + localS * charH;
              hlW = sWidth;
              hlH = count * charH;
            }

            partial = (
              <div
                style={{
                  position: 'absolute',
                  left: hlLeft,
                  top: hlTop,
                  width: hlW,
                  height: hlH,
                  backgroundColor:
                    'var(--text-selection, rgba(0, 122, 255, 0.5))',
                  pointerEvents: 'none',
                  zIndex: 11,
                }}
              />
            );
          }
        }
      } else if (isBoxSelected) {
        highlightStyle.border = '2px solid var(--interactive-accent)';
        highlightStyle.backgroundColor =
          'rgba(var(--interactive-accent-rgb), 0.5)';
      } else {
        highlightStyle.border =
          item.prob > 0.9
            ? '1px solid var(--color-green)'
            : item.prob > 0.7
              ? '1px solid var(--color-yellow)'
              : '1px solid var(--color-red)';
      }

      return (
        <React.Fragment key={idx}>
          <div style={highlightStyle} />
          {partial}
        </React.Fragment>
      );
    });
  };

  if (items.length === 0)
    return (
      <div
        ref={containerRef}
        className="empty-state-container"
        tabIndex={0}
        onPaste={handlePaste}
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          color: 'var(--text-muted)',
          outline: 'none',
        }}
      >
        <div style={{ fontSize: '3em' }}>🖼️</div>
        <div style={{ fontSize: '1.1em' }}>Select an image to start</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="mod-cta"
            onClick={() => handlePaste()}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Clipboard size={16} />
            Recognize Clipboard
          </button>
        </div>

        <div style={{ fontSize: '0.9em', opacity: 0.8 }}>
          or press{' '}
          <kbd style={{ fontFamily: 'var(--font-monospace)' }}>Ctrl+V</kbd>
        </div>
      </div>
    );

  const showNav = items.length > 1;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <style>{`
            @keyframes slideInRight {
                from { opacity: 0; transform: translateX(20px); }
                to { opacity: 1; transform: translateX(0); }
            }
            @keyframes slideInLeft {
                from { opacity: 0; transform: translateX(-20px); }
                to { opacity: 1; transform: translateX(0); }
            }
            .slide-in-right { animation: slideInRight 0.3s ease-out forwards; }
            .slide-in-left { animation: slideInLeft 0.3s ease-out forwards; }
        `}</style>

      {/* Progress Bar Area */}
      {showNav && (
        <div
          ref={progressBarRef}
          style={{
            height: '12px',
            backgroundColor: 'var(--background-modifier-border)',
            width: '100%',
            marginBottom: '4px',
            flexShrink: 0,
            zIndex: 10,
            display: 'flex',
            cursor: 'pointer',
          }}
          onWheel={(e) => {
            e.stopPropagation();
            if (e.deltaY > 0) nextImage();
            else prevImage();
          }}
          onMouseDown={(e) => {
            setIsScrubbing(true);
            // Immediate jump on click
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(
              0,
              Math.min(1, (e.clientX - rect.left) / rect.width),
            );
            const idx = Math.floor(ratio * items.length);
            if (idx >= 0 && idx < items.length) setCurrentIndex(idx);
          }}
        >
          {items.map((_, idx) => (
            <div
              key={idx}
              style={{
                flex: 1,
                height: '100%',
                backgroundColor:
                  idx === currentIndex
                    ? 'var(--interactive-accent)'
                    : 'transparent',
                borderRight:
                  idx < items.length - 1
                    ? '1px solid var(--background-primary)'
                    : 'none',
                transition: 'background-color 0.2s',
              }}
              title={`Image ${idx + 1}`}
              onMouseEnter={(e) => {
                if (idx !== currentIndex)
                  e.currentTarget.style.backgroundColor =
                    'var(--text-selection)';
              }}
              onMouseLeave={(e) => {
                if (idx !== currentIndex)
                  e.currentTarget.style.backgroundColor = 'transparent';
              }}
            />
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: 'var(--background-secondary)',
        }}
      >
        {/* Reset Button */}
        <div
          onClick={resetView}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            padding: '6px',
            backgroundColor: 'var(--interactive-normal)',
            borderRadius: '4px',
            cursor: 'pointer',
            zIndex: 50,
            opacity: 0.8,
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          }}
          title="Reset View"
        >
          <RotateCcw size={16} />
        </div>

        {/* Previous Button */}
        {showNav && (
          <div
            onClick={prevImage}
            style={{
              position: 'absolute',
              top: '50%',
              left: '10px',
              transform: 'translateY(-50%)',
              padding: '10px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: '50%',
              cursor: 'pointer',
              zIndex: 50,
              color: 'white',
              display: currentIndex > 0 ? 'flex' : 'none',
            }}
            title="Previous Image"
          >
            <ChevronLeft size={24} />
          </div>
        )}

        {/* Image Container Wrapper */}
        <div
          ref={containerRef}
          tabIndex={0}
          className={animClass}
          style={{
            width: '100%',
            height: '100%',
            userSelect: 'none',
            outline: 'none',
            overflow: 'hidden',
            position: 'relative',
            cursor: isPanning ? 'grabbing' : 'default',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
        >
          {imageUrl ? (
            <img
              ref={imgRef}
              src={imageUrl}
              style={{
                position: 'absolute',
                left: offset.x,
                top: offset.y,
                width: '100%',
                transform: `scale(${zoom})`,
                transformOrigin: '0 0',
                transformBox: 'fill-box',
                opacity: isLoaded ? 1 : 0,
                transition: 'opacity 0.2s ease-out',
              }}
              onLoad={handleLoad}
              draggable={false}
              alt="Preview"
            />
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '20px',
                color: 'var(--text-muted)',
              }}
            >
              No Image Data
            </div>
          )}

          {renderHighlights()}

          {/* Render Marquee Box */}
          {selectionMode === 'marquee' && dragStart && dragCurrent && (
            <div
              style={{
                position: 'absolute',
                left: Math.min(dragStart.x, dragCurrent.x),
                top: Math.min(dragStart.y, dragCurrent.y),
                width: Math.abs(dragCurrent.x - dragStart.x),
                height: Math.abs(dragCurrent.y - dragStart.y),
                border: '1px solid var(--interactive-accent)',
                backgroundColor: 'rgba(var(--interactive-accent-rgb), 0.2)',
                pointerEvents: 'none',
                zIndex: 100,
              }}
            />
          )}
        </div>

        {/* Next Button */}
        {showNav && (
          <div
            onClick={nextImage}
            style={{
              position: 'absolute',
              top: '50%',
              right: '10px',
              transform: 'translateY(-50%)',
              padding: '10px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: '50%',
              cursor: 'pointer',
              zIndex: 50,
              color: 'white',
              display: currentIndex < items.length - 1 ? 'flex' : 'none',
            }}
            title="Next Image"
          >
            <ChevronRight size={24} />
          </div>
        )}
      </div>
    </div>
  );
};
