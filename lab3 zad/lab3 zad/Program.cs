using System;
using System.Collections.Generic;
using System.Reflection.PortableExecutable;

class Program
{
    static void Main(string[] args)
    {
        var person1 = new Reader("Piotrek", "Kowalski", 29);
        var person2 = new Reviewer("Anna", "Nowak", 25);
        var person3 = new Reviewer("jan", "Męczynoga", 65);

        var book1 = new Book("Książka 1", person1, new DateTime(2020, 1, 1));
        var book2 = new Book("Książka 2", person2, new DateTime(2021, 5, 20));

        person1.AddBook(book1);
        person2.AddBook(book1);
        person2.AddBook(book2);
        person3.AddBook(book1);

        var listaOsob = new List<Person> { person1, person2 };

        foreach (var osoba in listaOsob)
        {
            osoba.View();
        }

        Console.WriteLine("\nRecenzje:");
        (person2 as Reviewer)?.Wypisz();
    }
}
