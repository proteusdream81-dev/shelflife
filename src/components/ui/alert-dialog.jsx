import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

/** @type {React.ForwardRefRenderFunction<React.ElementRef<typeof AlertDialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>>} */
const AlertDialogOverlayRender = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref} />
)
const AlertDialogOverlay = React.forwardRef(AlertDialogOverlayRender)
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

/** @type {React.ForwardRefRenderFunction<React.ElementRef<typeof AlertDialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>>} */
const AlertDialogContentRender = ({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg max-h-[85vh] overflow-y-auto overscroll-contain translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props} />
  </AlertDialogPortal>
)
const AlertDialogContent = React.forwardRef(AlertDialogContentRender)
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
    {...props} />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

/** @type {React.ForwardRefRenderFunction<React.ElementRef<typeof AlertDialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>>} */
const AlertDialogTitleRender = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
)
const AlertDialogTitle = React.forwardRef(AlertDialogTitleRender)
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

/** @type {React.ForwardRefRenderFunction<React.ElementRef<typeof AlertDialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>>} */
const AlertDialogDescriptionRender = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
)
const AlertDialogDescription = React.forwardRef(AlertDialogDescriptionRender)
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

/** @type {React.ForwardRefRenderFunction<React.ElementRef<typeof AlertDialogPrimitive.Action>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>>} */
const AlertDialogActionRender = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
)
const AlertDialogAction = React.forwardRef(AlertDialogActionRender)
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

/** @type {React.ForwardRefRenderFunction<React.ElementRef<typeof AlertDialogPrimitive.Cancel>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>>} */
const AlertDialogCancelRender = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0", className)}
    {...props} />
)
const AlertDialogCancel = React.forwardRef(AlertDialogCancelRender)
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
