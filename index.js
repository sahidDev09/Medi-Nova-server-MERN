const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 8000;

// middleware
const middleOption = {
  origin: [
    "http://localhost:5173",
    "https://medinova-dc16a.web.app",
    "https://medinova-dc16a.firebaseapp.com",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(middleOption));

app.use(express.json());
app.use(cookieParser());

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ak33ksp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    console.log("Connected to MongoDB");

    // All collections
    const allBanner = client.db("MediNova").collection("banners");
    const userCollection = client.db("MediNova").collection("users");
    const testsCollection = client.db("MediNova").collection("tests");
    const bookedAppointments = client.db("MediNova").collection("reservations");
    const allRecommendation = client
      .db("MediNova")
      .collection("recommendations");

    // Verify token middleware
    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).json({ message: "Unauthorized access" });
      }
      const token = authHeader.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_PRIVATE, (error, decoded) => {
        if (error) {
          return res.status(401).json({ message: "Unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // Verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden access" });
      }
      next();
    };

    // Create payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const price = req.body.price;
      if (!price || price < 0)
        return res.status(400).json({ message: "Invalid price" });
      const priceInCents = Math.round(parseFloat(price) * 100);
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: priceInCents,
          currency: "usd",
          automatic_payment_methods: {
            enabled: true,
          },
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Payment intent creation failed", error });
      }
    });

    //get all recommendation

    app.get("/recommendations", async (req, res) => {
      const reccom = await allRecommendation.find().toArray();
      res.json(reccom);
    });

    // Users get from MongoDB
    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.json(users);
    });

    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    // Check if user is admin
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).json({ message: "Unauthorized access" });
      }
      const user = await userCollection.findOne({ email });
      res.json({ admin: user?.role === "admin" });
    });

    // Check if user is blocked or active
    app.get("/users/status/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      if (user) {
        res.json({ active: user.status === "active" });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    });

    // User add to database
    app.post("/allusers", async (req, res) => {
      const user = req.body;
      const existUser = await userCollection.findOne({ email: user.email });
      if (existUser) {
        return res.json({
          message: "User already exists in database",
          insertedId: null,
        });
      }
      const result = await userCollection.insertOne(user);
      res.json(result);
    });

    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const userData = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: userData };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.json(result);
    });
    // Block user by admin
    app.patch(
      "/users/block/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: "blocked" } };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.json(result);
      }
    );

    // User info by ID
    app.get("/user/info/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const user = await userCollection.findOne({ _id: new ObjectId(id) });
      res.json(user);
    });

    // Make an admin
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { role: "admin" } };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.json(result);
      }
    );

    // Add test data
    app.post("/tests", async (req, res) => {
      const test = req.body;
      const result = await testsCollection.insertOne(test);
      res.json(result);
    });

    // Get test data
    app.get("/tests", async (req, res) => {
      const tests = await testsCollection.find().toArray();
      res.json(tests);
    });

    // Delete test
    app.delete("/tests/:id", async (req, res) => {
      const id = req.params.id;
      const result = await testsCollection.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    // Get test by ID
    app.get("/tests/:id", async (req, res) => {
      const id = req.params.id;
      const test = await testsCollection.findOne({ _id: new ObjectId(id) });
      res.json(test);
    });

    // Update test data
    app.patch("/tests/update/:id", async (req, res) => {
      const id = req.params.id;
      const testData = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: testData };
      const result = await testsCollection.updateOne(filter, updateDoc);
      res.json(result);
    });

    // Get banner data
    app.get("/banner", async (req, res) => {
      const banners = await allBanner.find({ status: "true" }).toArray();
      res.json(banners);
    });

    app.get("/allbanners", verifyToken, verifyAdmin, async (req, res) => {
      const banners = await allBanner.find().toArray();
      res.json(banners);
    });

    //delete banners

    app.delete("/allbanners/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await allBanner.deleteOne(query);
      res.send(result);
    });
    //add banner data

    app.post("/banner", async (req, res) => {
      const bannerData = req.body;
      const result = await allBanner.insertOne(bannerData);
      res.send(result);
    });

    //reservation under specific test

    app.get("/reservation/:test_id", async (req, res) => {
      const id = req.params.test_id;
      const query = { test_id: id };
      const result = await bookedAppointments.find(query).toArray();
      res.json(result);
    });

    //make displayed banner

    app.patch(
      "/allbanners/display/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = {};
        const updateDoc = { $set: { status: "false" } };
        await allBanner.updateMany(filter, updateDoc);

        const makedisID = { _id: new ObjectId(id) };
        const makeDisUpdateDoc = { $set: { status: "true" } };
        const result = await allBanner.updateOne(makedisID, makeDisUpdateDoc);

        res.json(result);
      }
    );

    //add booked data from client

    app.post("/bookings", async (req, res) => {
      const bookings = req.body;
      const result = await bookedAppointments.insertOne(bookings);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const result = await bookedAppointments.find().toArray();
      res.send(result);
    });

    //get bookings

    app.get("/bookings/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await bookedAppointments.find(query).toArray();
      res.send(result);
    });

    // cancel booking

    app.delete("/bookings/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookedAppointments.deleteOne(query);
      res.send(result);
    });

    // Auth related API
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_PRIVATE, {
        expiresIn: "30d",
      });
      res.json({ token });
    });

    // Ping to check MongoDB connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.error("An error occurred while running the server:", error);
  }
}

run().catch(console.dir);

// End of MongoDB

app.get("/", (req, res) => {
  res.send("Hello MediNova");
});

app.listen(port, () => {
  console.log(`MediNova is running on port: ${port}`);
});
