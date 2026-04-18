import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({ className = "", sideOffset = 8, align = "end", ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={`z-50 min-w-[12rem] rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg outline-none ${className}`.trim()}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className = "", inset = false, ...props }) {
  return (
    <DropdownMenuPrimitive.Item
      className={`flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-gray-700 outline-none focus:bg-gray-100 ${inset ? "pl-8" : ""} ${className}`.trim()}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className = "", ...props }) {
  return <DropdownMenuPrimitive.Separator className={`my-1 h-px bg-gray-200 ${className}`.trim()} {...props} />;
}
