// The product build is the same Chat implementation under real Host admission.
// The flag is set before the shell module evaluates its boot path.
import { markProductShell } from "./product-flag";

markProductShell();
void import("./client.tsx");
