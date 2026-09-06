import { MerkleSumTree } from "pyt-merkle-sum-tree";

const tree = new MerkleSumTree("./src/customers.csv");


// specific customer and amount to find in the tree 
const customerId = "customer-123";
const amount = 12550n;

const index = tree.indexOf(customerId, amount); // returns index -1 if not found otherwise returns the index of the customer in the tree

if (index === -1) {
  console.log("didn't find customer");
} else {
  const proof = tree.createProof(index);

  console.log("Proof:", proof);

  const valid = tree.verifyProof(proof);

  console.log("Proof valid:", valid);
  console.log("Root:", tree.root);
}