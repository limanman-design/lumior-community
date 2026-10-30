import { LumiorSplitLoader } from "@/components/ui/lumior-split-loader"

export default function LumiorSplitLoaderDemo() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-12 bg-background p-8">
      {/* Splash / full-page loading */}
      <LumiorSplitLoader variant="splash" size={280} label="Lumior 正在启动" />

      {/* Inline loading, e.g. while AI splits a long note into cards */}
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-[var(--ui-fill-subtle)] py-1.5 pl-1.5 pr-4 text-sm text-muted-foreground">
        <LumiorSplitLoader variant="inline" size={32} label="正在拆分知识点" />
        正在拆分知识点…
      </div>
    </div>
  )
}
