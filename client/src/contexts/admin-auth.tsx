import { createContext, useContext } from "react";

export interface AdminAuthContextType {
  isAdminAuthed: boolean;
  setAdminAuthed: (v: boolean) => void;
}

export const AdminAuthContext = createContext<AdminAuthContextType>({
  isAdminAuthed: false,
  setAdminAuthed: () => {},
});

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}
