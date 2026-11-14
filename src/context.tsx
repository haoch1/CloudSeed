import { createContext, useContext } from "react";
import type { Account } from "../shared/types";

export const AccountContext = createContext<{
  accounts: Account[];
  account?: Account;
  setAccount: (id: string) => void;
}>({ accounts: [], setAccount: () => {} });
export const useAccount = () => useContext(AccountContext);
