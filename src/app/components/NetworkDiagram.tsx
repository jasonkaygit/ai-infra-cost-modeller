"use client";

import React, { useState, useMemo } from "react";
import type { CostBreakdown, ComponentCostLine } from "../../domain/types";
import { gbp } from "../format";

/* ------------------------------------------------------------------ palette */

const CAT_COLORS: Record<string, string> = {
  VOICE_SERVICE: "#38E1B0",
  AI_AND_COMPUTE: "#5CD0E8",
  TELEPHONY_AND_INTEGRATION: "#8B9DCC",
  KNOWLEDGE: "#C4A6FF",
  AUDIO_TRANSCRIPT_STORAGE: "#FFB347",
  EVALUATION_AND_ASSURANCE: "#FF6B8A",
  OPERATIONS_AND_OBSERVABILITY: "#F0E68C",
  DATA_AND_ANALYTICS: "#FF9F7B",
  HUMAN_ESCALATION: "#C084FC",
  FIXED_OPERATIONAL: "#94A3B8",
};

const LANE_COLORS = [
  "rgba(56,225,176,0.06)",
  "rgba(92,208,232,0.04)",
  "rgba(139,157,204,0.06)",
  "rgba(196,166,255,0.04)",
  "rgba(255,179,71,0.06)",
  "rgba(255,107,138,0.04)",
];

const LANE_LABELS = [
  "Ingress",
  "Voice Processing",
  "Orchestration",
  "AI & Compute",
  "Data & Storage",
  "Observability & Ops",
];

/* ------------------------------------------------------------------ node definitions */

interface DiagramNode {
  id: string;
  label: string;
  provider: string;
  category: string;
  cost: number;
  lane: number; // 0-5
  slot: number; // position within lane
  w: number;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

/* Map component IDs to nodes with lane/slot layout */
function buildNodes(lines: ComponentCostLine[]): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const map = new Map(lines.map((l) => [l.componentId, l]));

  const nodeSpecs: { id: string; lane: number; slot: number }[] = [
    // Lane 0 - Ingress
    { id: "chime-sip-minutes", lane: 0, slot: 0 },
    // Lane 1 - Voice Processing
    { id: "alb-load-balancer", lane: 1, slot: 0 },
    { id: "livekit-media", lane: 1, slot: 1 },
    { id: "asr-tts-speech", lane: 1, slot: 2 },
    // Lane 2 - Orchestration
    { id: "eks-hosting", lane: 2, slot: 0 },
    { id: "n8n-integration", lane: 2, slot: 1 },
    { id: "api-gateway", lane: 2, slot: 2 },
    // Lane 3 - AI & Compute
    { id: "bedrock-llm-io", lane: 3, slot: 0 },
    { id: "ec2-nitro-inference", lane: 3, slot: 1 },
    { id: "bedrock-search", lane: 3, slot: 2 },
    { id: "sagemaker-eval-compute", lane: 3, slot: 3 },
    // Lane 4 - Data & Storage
    { id: "dynamodb-compute", lane: 4, slot: 0 },
    { id: "s3-storage", lane: 4, slot: 1 },
    { id: "vector-index-storage", lane: 4, slot: 2 },
    // Lane 5 - Observability & Ops
    { id: "cloud-logging", lane: 5, slot: 0 },
    { id: "managed-prometheus", lane: 5, slot: 1 },
    { id: "eval-llm", lane: 5, slot: 2 },
    { id: "eval-storage", lane: 5, slot: 3 },
    // Voice supplier components
    { id: "voice-a-percall", lane: 1, slot: 3 },
    { id: "voice-b-perminute", lane: 1, slot: 3 },
    { id: "voice-c-persession", lane: 1, slot: 3 },
    // Other components not in main diagram go to a sidebar
    { id: "human-escalation", lane: 0, slot: 2 },
    { id: "networking-overhead", lane: 1, slot: 4 },
    { id: "dynamodb-storage", lane: 4, slot: 4 },
    { id: "s3-egress", lane: 4, slot: 3 },
    { id: "redshift-placeholder", lane: 4, slot: 5 },
    { id: "platform-ops", lane: 5, slot: 4 },
    { id: "preprod-environments", lane: 5, slot: 5 },
    { id: "support-plans", lane: 5, slot: 6 },
    { id: "implementation-oneoff", lane: 5, slot: 7 },
  ];

  const nodes: DiagramNode[] = [];
  const seen = new Set<string>();

  // Add nodes that exist in the breakdown
  for (const spec of nodeSpecs) {
    const line = map.get(spec.id);
    if (!line || line.annualCost <= 0) continue;
    seen.add(spec.id);
    nodes.push({
      id: line.componentId,
      label: line.service,
      provider: line.provider,
      category: line.category,
      cost: line.annualCost,
      lane: spec.lane,
      slot: spec.slot,
      w: 150,
    });
  }

  // Add any remaining components not in the spec
  for (const l of lines) {
    if (!seen.has(l.componentId) && l.annualCost > 0) {
      nodes.push({
        id: l.componentId,
        label: l.service,
        provider: l.provider,
        category: l.category,
        cost: l.annualCost,
        lane: 5,
        slot: nodes.filter((n) => n.lane === 5).length,
        w: 150,
      });
    }
  }

  // Edges: define known connections
  const edges: DiagramEdge[] = [
    // Call flow: PSTN → ALB → LiveKit → EKS → Bedrock
    { from: "chime-sip-minutes", to: "alb-load-balancer", label: "SIP" },
    { from: "alb-load-balancer", to: "livekit-media", label: "media" },
    { from: "livekit-media", to: "eks-hosting", label: "orchestrate" },
    { from: "eks-hosting", to: "bedrock-llm-io", label: "LLM" },
    { from: "eks-hosting", to: "bedrock-search", label: "RAG" },
    { from: "eks-hosting", to: "api-gateway", label: "API" },
    { from: "livekit-media", to: "asr-tts-speech", label: "audio" },
    // Data flow
    { from: "bedrock-llm-io", to: "s3-storage", label: "logs" },
    { from: "api-gateway", to: "dynamodb-compute", label: "state" },
    { from: "eks-hosting", to: "n8n-integration", label: "workflows" },
    // Observability
    { from: "eks-hosting", to: "cloud-logging" },
    { from: "eks-hosting", to: "managed-prometheus" },
    { from: "livekit-media", to: "cloud-logging" },
    { from: "bedrock-llm-io", to: "cloud-logging" },
    // Evaluation
    { from: "s3-storage", to: "eval-llm", label: "sample" },
    { from: "eval-llm", to: "eval-storage", label: "results" },
    // Voice supplier
    { from: "alb-load-balancer", to: "voice-a-percall" },
    { from: "alb-load-balancer", to: "voice-b-perminute" },
    { from: "alb-load-balancer", to: "voice-c-persession" },
    // Human
    { from: "eks-hosting", to: "human-escalation", label: "escalate" },
  ];

  // Filter edges to only include nodes that exist
  const nodeIds = new Set(nodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  return { nodes, edges: filteredEdges };
}

/* ------------------------------------------------------------------ */

const W = 1050;
const LANE_H = 108;
const LANE_GAP = 12;
const TOP_MARGIN = 8;
const NODE_W = 150;
const NODE_H = 40;
const SIDE_W = 180;

export function NetworkDiagram({ breakdown }: { breakdown: CostBreakdown }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const { nodes, edges, totalH, fixedLaneNodes } = useMemo(() => {
    const { nodes, edges } = buildNodes(breakdown.lines);

    // Sort nodes within each lane by slot, then recalculate x positions
    const lanes = Array.from({ length: 6 }, () => [] as DiagramNode[]);
    for (const n of nodes) {
      if (n.lane >= 0 && n.lane < 6) lanes[n.lane].push(n);
    }

    // Position nodes in each lane (evenly spaced)
    for (let i = 0; i < 6; i++) {
      const count = lanes[i].length;
      if (count === 0) continue;
      const laneW = W - 60;
      const gap = count > 1 ? Math.min(40, (laneW - count * NODE_W) / (count - 1)) : 0;
      const totalW = count * NODE_W + (count - 1) * gap;
      const startX = (W - totalW) / 2;
      for (let j = 0; j < count; j++) {
        lanes[i][j].slot = j;
        lanes[i][j].w = NODE_W;
      }
    }

    const totalH = 6 * LANE_H + (6 - 1) * LANE_GAP + TOP_MARGIN + 40;

    // Fixed-cost nodes (no specific lane) go to a sidebar
    const fixedLaneNodes = nodes.filter(
      (n) => n.category === "FIXED_OPERATIONAL"
    );

    return { nodes, edges, totalH, fixedLaneNodes };
  }, [breakdown]);

  if (nodes.length === 0) return null;

  // Compute positions for rendering
  const nodePositions = new Map<string, { x: number; y: number; w: number; h: number }>();
  const lanes = Array.from({ length: 6 }, () => [] as DiagramNode[]);
  for (const n of nodes) {
    if (n.lane >= 0 && n.lane < 6) lanes[n.lane].push(n);
  }

  for (let li = 0; li < 6; li++) {
    const count = lanes[li].length;
    if (count === 0) continue;
    const laneW = W - 60;
    const gap = count > 1 ? Math.min(40, (laneW - count * NODE_W) / (count - 1)) : 0;
    const totalW = count * NODE_W + (count - 1) * gap;
    const startX = (W - totalW) / 2;
    const y = TOP_MARGIN + li * (LANE_H + LANE_GAP) + 28;

    for (let j = 0; j < count; j++) {
      const x = startX + j * (NODE_W + gap);
      nodePositions.set(lanes[li][j].id, { x, y, w: NODE_W, h: NODE_H });
    }
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W + SIDE_W} ${totalH}`} className="w-full min-w-[900px]">

        {/* Lane backgrounds */}
        {LANE_LABELS.map((label, i) => {
          const y = TOP_MARGIN + i * (LANE_H + LANE_GAP);
          return (
            <g key={i}>
              <rect
                x={8}
                y={y}
                width={W - 16}
                height={LANE_H}
                rx={10}
                fill={LANE_COLORS[i]}
                stroke="#1e2833"
                strokeWidth={1}
              />
              <text
                x={20}
                y={y + 18}
                className="eyebrow"
                fill="#5b6673"
                fontSize={10}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Edges */}
        <g>
          {edges.map((edge, i) => {
            const from = nodePositions.get(edge.from);
            const to = nodePositions.get(edge.to);
            if (!from || !to) return null;

            const isActive =
              hovered === edge.from || hovered === edge.to || hovered === null;

            // Arrow from bottom of source to top of target
            const x1 = from.x + from.w / 2;
            const y1 = from.y + from.h;
            const x2 = to.x + to.w / 2;
            const y2 = to.y;

            return (
              <g key={i} opacity={isActive ? 0.6 : 0.15} className="transition-opacity">
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2 - 4}
                  stroke="#5b6673"
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                />
                {/* Arrowhead */}
                <polygon
                  points={`${x2 - 4},${y2 - 6} ${x2 + 4},${y2 - 6} ${x2},${y2}`}
                  fill="#5b6673"
                />
                {edge.label && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 2}
                    textAnchor="middle"
                    className="figure"
                    fill="#5b6673"
                    fontSize={8}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {nodes.map((node) => {
            const pos = nodePositions.get(node.id);
            if (!pos) return null;

            const active = hovered === node.id;
            const dimmed = hovered && hovered !== node.id;
            const color = CAT_COLORS[node.category] ?? "#555";

            return (
              <g
                key={node.id}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
                opacity={dimmed ? 0.3 : 1}
              >
                {/* Node box */}
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={pos.w}
                  height={pos.h}
                  rx={6}
                  fill={active ? "#1a2030" : "#111820"}
                  stroke={active ? color : "#1e2833"}
                  strokeWidth={active ? 1.5 : 1}
                  className="transition-all"
                />
                {/* Category indicator bar */}
                <rect
                  x={pos.x + 4}
                  y={pos.y + 4}
                  width={3}
                  height={pos.h - 8}
                  rx={1.5}
                  fill={color}
                />
                {/* Service name */}
                <text
                  x={pos.x + 13}
                  y={pos.y + 16}
                  className="figure"
                  fill={active ? "#e6edf3" : "#94a3b8"}
                  fontSize={10}
                >
                  {node.label.length > 20 ? node.label.slice(0, 18) + "…" : node.label}
                </text>
                {/* Provider */}
                <text
                  x={pos.x + 13}
                  y={pos.y + 30}
                  className="figure"
                  fill="#5b6673"
                  fontSize={9}
                >
                  {node.provider}
                </text>

                {/* Cost tooltip on hover */}
                {active && (
                  <g>
                    <rect
                      x={pos.x + pos.w + 6}
                      y={pos.y}
                      width={140}
                      height={pos.h}
                      rx={6}
                      fill="#1a1f2b"
                      stroke={color}
                      strokeWidth={1}
                    />
                    <text
                      x={pos.x + pos.w + 14}
                      y={pos.y + 16}
                      className="figure"
                      fill={color}
                      fontSize={11}
                    >
                      {gbp(node.cost, { compact: true })} / yr
                    </text>
                    <text
                      x={pos.x + pos.w + 14}
                      y={pos.y + 30}
                      className="figure"
                      fill="#5b6673"
                      fontSize={9}
                    >
                      {((node.cost / breakdown.totalAnnual) * 100).toFixed(1)}% of TCO
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* Legend */}
        <g>
          <rect x={W - 220} y={totalH - 30} width={200} height={22} rx={6} fill="#111820" stroke="#1e2833" />
          <text x={W - 120} y={totalH - 15} textAnchor="middle" className="figure" fill="#5b6673" fontSize={9}>
            Hover any node to see cost · Dashed lines = data/call flow
          </text>
        </g>

      </svg>
    </div>
  );
}
