import Link from "next/link";

export default function DeclinedPage() {
  return (
    <>
      <h1>Declined</h1>
      <p>This synthetic lab did not process a payment.</p>
      <p>No card data was stored or logged.</p>
      <Link href="/" className="btn">
        Back to the catalog
      </Link>
    </>
  );
}
