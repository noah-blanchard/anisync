"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet on small screens; side sheet ("sheet") or centered dialog ("dialog") on large ones.
 */
export function ResponsiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  variant = "sheet",
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  variant?: "sheet" | "dialog";
  children: React.ReactNode;
  className?: string;
}) {
  const large = useMediaQuery(variant === "sheet" ? "(min-width: 1024px)" : "(min-width: 768px)");

  if (large && variant === "sheet") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className={cn("overflow-y-auto", className)}>
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">{description ?? title}</SheetDescription>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  if (large) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={className}>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={className}>
        {variant === "sheet" ? (
          <>
            <DrawerTitle className="sr-only">{title}</DrawerTitle>
            <DrawerDescription className="sr-only">{description ?? title}</DrawerDescription>
          </>
        ) : (
          <div className="px-5 pt-2">
            <DrawerTitle className="text-lg">{title}</DrawerTitle>
            {description ? <DrawerDescription className="mt-1">{description}</DrawerDescription> : null}
          </div>
        )}
        <div className="overflow-y-auto pb-safe">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
