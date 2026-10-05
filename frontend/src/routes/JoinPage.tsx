import { Navigate, useParams } from "react-router-dom";

/**
 * Invite links (`/join/<code>`) open Find room on the Rooms page with the code filled in and looked
 * up. Signed-out visitors are sent to sign in first; the link is remembered and opened afterwards.
 */
export function JoinPage() {
  const { code = "" } = useParams();
  return <Navigate to="/rooms" replace state={{ invite: code }} />;
}
