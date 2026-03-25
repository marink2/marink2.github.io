const currentPage = document.body.dataset.page;

for (const link of document.querySelectorAll(".nav-links a")) {
  const href = link.getAttribute("href");
  if (!href) {
    continue;
  }

  const pageName = href.replace(".html", "");
  const normalizedCurrent = currentPage === "home" ? "index" : currentPage;

  if (pageName === normalizedCurrent) {
    link.classList.add("is-active");
    link.setAttribute("aria-current", "page");
  }
}

const elementStyles = {
  C: { color: "#5f6874", radius: 18 },
  H: { color: "#f8f9fb", radius: 11 },
};

const bondColor = "rgba(136, 147, 159, 0.9)";
const lightDirection = normalizeVector({ x: -0.55, y: -0.6, z: 0.95 });
const fillDirection = normalizeVector({ x: 0.45, y: 0.35, z: 0.3 });

for (const container of document.querySelectorAll(".trajectory-viewer")) {
  setupTrajectoryViewer(container);
}

async function setupTrajectoryViewer(container) {
  const filePath = container.dataset.trajectory;
  const canvas = container.querySelector("canvas");
  const timeLabel = container.querySelector(".viewer-time");
  const toggle = container.querySelector(".viewer-toggle");
  const scrubber = container.querySelector('input[type="range"]');

  if (!filePath || !canvas || !timeLabel || !toggle || !scrubber) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const resizeCanvas = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 820;
    const height = canvas.clientHeight || 520;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  let response;
  try {
    response = await fetch(filePath);
  } catch {
    timeLabel.textContent = "Trajectory unavailable";
    toggle.disabled = true;
    scrubber.disabled = true;
    return;
  }

  if (!response.ok) {
    timeLabel.textContent = "Trajectory unavailable";
    toggle.disabled = true;
    scrubber.disabled = true;
    return;
  }

  const xyzText = await response.text();
  const frames = parseXyzTrajectory(xyzText);

  if (!frames.length) {
    timeLabel.textContent = "No frames found";
    toggle.disabled = true;
    scrubber.disabled = true;
    return;
  }

  scrubber.max = String(frames.length - 1);

  let frameIndex = 0;
  let isPlaying = true;
  let lastFrameTime = 0;
  const camera = {
    rotationY: -0.65,
    rotationX: 0.55,
    isDragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  };

  const render = () => {
    drawFrame(
      context,
      canvas,
      frames[frameIndex],
      camera,
    );
    timeLabel.textContent = `${frames[frameIndex].time.toFixed(2)} fs`;
    scrubber.value = String(frameIndex);
  };

  toggle.addEventListener("click", () => {
    isPlaying = !isPlaying;
    toggle.textContent = isPlaying ? "Pause" : "Play";
  });

  scrubber.addEventListener("input", () => {
    frameIndex = Number(scrubber.value);
    render();
  });

  canvas.addEventListener("pointerdown", (event) => {
    camera.isDragging = true;
    camera.pointerId = event.pointerId;
    camera.lastX = event.clientX;
    camera.lastY = event.clientY;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!camera.isDragging || event.pointerId !== camera.pointerId) {
      return;
    }

    const deltaX = event.clientX - camera.lastX;
    const deltaY = event.clientY - camera.lastY;
    camera.lastX = event.clientX;
    camera.lastY = event.clientY;
    camera.rotationY += deltaX * 0.01;
    camera.rotationX += deltaY * 0.01;
    camera.rotationX = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotationX));
    render();
  });

  const endDrag = (event) => {
    if (event.pointerId !== camera.pointerId) {
      return;
    }

    camera.isDragging = false;
    camera.pointerId = null;
    canvas.classList.remove("is-dragging");
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", (event) => {
    if (camera.isDragging && event.pointerId === camera.pointerId) {
      endDrag(event);
    }
  });

  const animate = (timestamp) => {
    if (isPlaying && timestamp - lastFrameTime > 140) {
      frameIndex = (frameIndex + 1) % frames.length;
      lastFrameTime = timestamp;
      render();
    }

    requestAnimationFrame(animate);
  };

  render();
  requestAnimationFrame(animate);
}

function parseXyzTrajectory(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const frames = [];

  let index = 0;
  while (index < lines.length) {
    const atomCount = Number.parseInt(lines[index], 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) {
      break;
    }

    const comment = lines[index + 1] || "";
    const timeMatch = comment.match(/^\s*([+-]?\d+(?:\.\d+)?)/);
    const time = timeMatch ? Number.parseFloat(timeMatch[1]) : frames.length;
    const atoms = [];

    for (let atomIndex = 0; atomIndex < atomCount; atomIndex += 1) {
      const atomLine = lines[index + 2 + atomIndex];
      if (!atomLine) {
        break;
      }

      const [element, x, y, z] = atomLine.split(/\s+/);
      atoms.push({
        element,
        x: Number.parseFloat(x),
        y: Number.parseFloat(y),
        z: Number.parseFloat(z),
      });
    }

    if (atoms.length === atomCount) {
      frames.push({ time, atoms });
    }

    index += atomCount + 2;
  }

  return frames;
}

function drawFrame(context, canvas, frame, camera) {
  const width = canvas.clientWidth || 820;
  const height = canvas.clientHeight || 520;

  context.clearRect(0, 0, width, height);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const rotated = frame.atoms.map((atom) => rotateAtom(atom, camera.rotationY, camera.rotationX));
  const scale = computeScale(rotated, width, height);
  const projected = rotated.map((atom) => projectAtom(atom, scale, width, height));

  drawGroundShadow(context, projected, height);

  const bonds = findBonds(rotated);
  for (const [startIndex, endIndex] of bonds) {
    const start = projected[startIndex];
    const end = projected[endIndex];
    const depth = (start.depth + end.depth) / 2;
    const bondWidth = Math.max(3, 5 + depth * 0.8);
    const bondVector = normalizeVector({
      x: rotated[endIndex].x - rotated[startIndex].x,
      y: rotated[endIndex].y - rotated[startIndex].y,
      z: rotated[endIndex].z - rotated[startIndex].z,
    });
    const bondLight = Math.max(0, dotProduct(bondVector, lightDirection));
    const bondFill = Math.max(0, dotProduct(bondVector, fillDirection));
    const bondMidTone = Math.round(120 + bondLight * 50 + bondFill * 20);
    const gradient = context.createLinearGradient(start.screenX, start.screenY, end.screenX, end.screenY);
    gradient.addColorStop(0, `rgba(${180 + Math.round(bondFill * 18)}, ${188 + Math.round(bondFill * 16)}, ${198 + Math.round(bondFill * 12)}, 0.95)`);
    gradient.addColorStop(0.5, `rgba(${bondMidTone}, ${bondMidTone + 8}, ${bondMidTone + 16}, 0.95)`);
    gradient.addColorStop(1, `rgba(${96 + Math.round(bondLight * 22)}, ${108 + Math.round(bondLight * 18)}, ${122 + Math.round(bondLight * 14)}, 0.95)`);

    context.strokeStyle = gradient;
    context.lineWidth = bondWidth;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(start.screenX, start.screenY);
    context.lineTo(end.screenX, end.screenY);
    context.stroke();
  }

  const depthSorted = projected
    .map((atom, atomIndex) => ({ ...atom, atomIndex }))
    .sort((left, right) => left.depth - right.depth);

  for (const atom of depthSorted) {
    const style = elementStyles[atom.element] || { color: "#d9d9d9", radius: 12 };
    const renderRadius = Math.max(7, style.radius * (1 + atom.depth * 0.12));
    const normal = normalizeVector({
      x: atom.x * 0.85,
      y: atom.y * 0.85,
      z: atom.depth + renderRadius * 0.02,
    });
    const diffuse = Math.max(0, dotProduct(normal, lightDirection));
    const fill = Math.max(0, dotProduct(normal, fillDirection));
    const rim = Math.pow(Math.max(0, 1 - Math.abs(normal.z)), 1.6);
    const specular = Math.pow(Math.max(0, dotProduct(normal, normalizeVector({
      x: lightDirection.x,
      y: lightDirection.y,
      z: lightDirection.z + 1,
    }))), 10);
    const highlightStrength = 0.18 + diffuse * 0.32 + fill * 0.16 + specular * 0.34;
    const shadowStrength = 0.28 + (1 - diffuse) * 0.34;
    const gradient = context.createRadialGradient(
      atom.screenX - renderRadius * (0.34 + lightDirection.x * 0.08),
      atom.screenY - renderRadius * (0.42 + lightDirection.y * 0.08),
      renderRadius * 0.1,
      atom.screenX,
      atom.screenY,
      renderRadius,
    );
    const baseRgb = atom.element === "H"
      ? { r: 240, g: 244, b: 249 }
      : { r: 95, g: 104, b: 116 };
    const highlightRgb = lightenColor(baseRgb, highlightStrength);
    const midRgb = lightenColor(baseRgb, fill * 0.12);
    const shadowRgb = darkenColor(baseRgb, shadowStrength);

    gradient.addColorStop(0, rgbString(highlightRgb));
    gradient.addColorStop(0.28, rgbString(lightenColor(midRgb, specular * 0.2)));
    gradient.addColorStop(0.68, rgbString(midRgb));
    gradient.addColorStop(1, rgbString(darkenColor(shadowRgb, rim * 0.12)));

    context.beginPath();
    context.fillStyle = gradient;
    context.arc(atom.screenX, atom.screenY, renderRadius, 0, Math.PI * 2);
    context.fill();

    context.lineWidth = 1.4;
    context.strokeStyle = atom.element === "H" ? "rgba(120, 132, 145, 0.22)" : "rgba(55, 68, 82, 0.2)";
    context.stroke();

    context.beginPath();
    context.fillStyle = `rgba(255, 255, 255, ${0.16 + specular * 0.22})`;
    context.ellipse(
      atom.screenX - renderRadius * 0.28,
      atom.screenY - renderRadius * 0.34,
      renderRadius * 0.26,
      renderRadius * 0.18,
      -0.6,
      0,
      Math.PI * 2,
    );
    context.fill();

    context.fillStyle = atom.element === "H" ? "#536070" : "#f8fbff";
    context.font = '700 12px system-ui, sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(atom.element, atom.screenX, atom.screenY);
  }
}

function drawGroundShadow(context, atoms, height) {
  const shadow = context.createRadialGradient(
    context.canvas.clientWidth / 2,
    height * 0.78,
    10,
    context.canvas.clientWidth / 2,
    height * 0.78,
    height * 0.22,
  );

  shadow.addColorStop(0, "rgba(48, 65, 82, 0.18)");
  shadow.addColorStop(1, "rgba(48, 65, 82, 0)");

  const minX = Math.min(...atoms.map((atom) => atom.screenX));
  const maxX = Math.max(...atoms.map((atom) => atom.screenX));
  const width = Math.max(120, (maxX - minX) * 1.25);
  const centerX = (minX + maxX) / 2;

  context.save();
  context.translate(centerX, height * 0.8);
  context.scale(width / 220, 0.42);
  context.beginPath();
  context.fillStyle = shadow;
  context.arc(0, 0, 110, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function rotateAtom(atom, rotationY, rotationX) {
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);

  const x1 = atom.x * cosY - atom.z * sinY;
  const z1 = atom.x * sinY + atom.z * cosY;
  const y2 = atom.y * cosX - z1 * sinX;
  const z2 = atom.y * sinX + z1 * cosX;

  return { ...atom, x: x1, y: y2, z: z2 };
}

function computeScale(atoms, width, height) {
  const extent = atoms.reduce((maxExtent, atom) => {
    return Math.max(maxExtent, Math.abs(atom.x), Math.abs(atom.y), Math.abs(atom.z));
  }, 1);

  return Math.min(width, height) * 0.28 / extent;
}

function projectAtom(atom, scale, width, height) {
  const perspective = 1 / (1 - atom.z * 0.18);

  return {
    ...atom,
    screenX: width / 2 + atom.x * scale * perspective,
    screenY: height / 2 - atom.y * scale * perspective,
    depth: atom.z,
  };
}

function findBonds(atoms) {
  const bonds = [];

  for (let leftIndex = 0; leftIndex < atoms.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < atoms.length; rightIndex += 1) {
      const left = atoms[leftIndex];
      const right = atoms[rightIndex];
      const isCarbonHydrogenPair =
        (left.element === "C" && right.element === "H") ||
        (left.element === "H" && right.element === "C");

      if (!isCarbonHydrogenPair) {
        continue;
      }

      const distance = Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

      if (distance < 2.25) {
        bonds.push([leftIndex, rightIndex]);
      }
    }
  }

  return bonds;
}

function dotProduct(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function lightenColor(color, amount) {
  return {
    r: Math.round(color.r + (255 - color.r) * Math.max(0, Math.min(1, amount))),
    g: Math.round(color.g + (255 - color.g) * Math.max(0, Math.min(1, amount))),
    b: Math.round(color.b + (255 - color.b) * Math.max(0, Math.min(1, amount))),
  };
}

function darkenColor(color, amount) {
  return {
    r: Math.round(color.r * (1 - Math.max(0, Math.min(1, amount)))),
    g: Math.round(color.g * (1 - Math.max(0, Math.min(1, amount)))),
    b: Math.round(color.b * (1 - Math.max(0, Math.min(1, amount)))),
  };
}

function rgbString(color) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}
