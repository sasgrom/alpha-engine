import { trpc } from "@/providers/trpc";
import { useAuth } from "./useAuth";

export function useReviewer() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const status = trpc.reviewer.status.useQuery(undefined, { enabled: !!user, retry: false });
  const acceptNda = trpc.reviewer.acceptNda.useMutation({
    onSuccess: () => utils.reviewer.status.invalidate(),
  });
  const tourAction = trpc.reviewer.tourAction.useMutation({
    onSuccess: () => utils.reviewer.status.invalidate(),
  });
  return { user, status, acceptNda, tourAction };
}
