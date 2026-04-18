import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuLabel = DropdownMenuPrimitive.Label;

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

export function DropdownMenuCheckboxItem({ className = "", checked, ...props }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={`flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-gray-700 outline-none focus:bg-gray-100 ${className}`.trim()}
      {...props}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-gray-300 bg-white">
        <DropdownMenuPrimitive.ItemIndicator>
          <svg className="h-3.5 w-3.5 text-tm-leaf" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 011.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z"
              clipRule="evenodd"
            />
          </svg>
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1">{props.children}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuSeparator({ className = "", ...props }) {
  return <DropdownMenuPrimitive.Separator className={`my-1 h-px bg-gray-200 ${className}`.trim()} {...props} />;
}
