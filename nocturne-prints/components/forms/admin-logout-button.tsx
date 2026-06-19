"use client";

import { Button } from "@/components/ui/button";

export function AdminLogoutButton() {
  return (
    <Button
      variant="outline"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        window.location.href = "/admin/login";
      }}
    >
      Wyloguj
    </Button>
  );
}
