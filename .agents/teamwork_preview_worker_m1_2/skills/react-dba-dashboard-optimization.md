---
name: react-dba-dashboard-optimization
description: Best practices and architecture for real-time telemetry streaming, Recharts 60fps rendering, memory containment, and RBAC guard enforcement in React 19 + TypeScript.
---

# React 19 Real-Time Telemetry & DBA Dashboard Optimization Skill

Use this skill when implementing high-frequency metric visualizations, optimizing chart rendering, architecting streaming telemetry buffers, or scaling RBAC and report generation in DataPulse Sentinel.

## 1. High-Frequency Telemetry Ring Buffers

To prevent memory leaks and garbage collection thrashing during live metric polling:
- Maintain fixed-size circular windowing (e.g. 20-30 historical data points).
- Compute aggregations on append rather than re-traversing the full array on render.

```typescript
export function appendMetricPoint<T>(
  history: T[],
  newPoint: T,
  maxPoints: number = 25
): T[] {
  const next = [...history, newPoint];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
}
```

---

## 2. Recharts 60fps Optimization Guidelines

1. **Disable Unnecessary Transitions**: Set `isAnimationActive={false}` on rapidly updated line/area charts to avoid frame drops during sub-second ticker intervals.
2. **Memoize Static Gradients & Tooltip Formats**: Isolate tooltip content generators outside chart re-renders.
3. **ResponsiveContainer Sizing**: Always ensure parent wrapper has explicit `h-64` or pixel dimensions to prevent continuous recalculation of flexbox dimensions.

---

## 3. Granular RBAC Permission Guards Pattern

Enforce permission checks at both component and action dispatch levels:

```typescript
export const RequirePermission: React.FC<{
  permission: keyof UserPermissions;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}> = ({ permission, fallback = null, children }) => {
  const { currentUser } = useDBA();
  if (!currentUser.permissions[permission]) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
};
```

---

## 4. High-Resolution PDF Compliance Export (`jsPDF` + `html2canvas`)

When exporting multi-page DBA compliance reports:
1. Render to an off-screen fixed-width standard A4 canvas container (`210mm x 297mm`).
2. Use `scale: 2` in `html2canvas` for sharp typography and vector-like lines.
3. Maintain high contrast with explicit background colors (`#ffffff`) for PDF print friendliness.
