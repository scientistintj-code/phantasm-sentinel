import { Catalog } from "@/components/catalog";
import { getCurrentStorefront } from "@/lib/storefronts";

export default function CatalogPage() {
  const store = getCurrentStorefront();
  return (
    <>
      <h1>{store.catalogTitle}</h1>
      <Catalog products={store.products} />
    </>
  );
}
