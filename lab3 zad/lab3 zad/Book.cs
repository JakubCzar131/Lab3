using System;

public class Book
{
    protected string Title { get; set; }
    protected Person Author { get; set; }
    protected DateTime DataWydania { get; set; }

    public Book(string title, Person author, DateTime dataWydania)
    {
        Title = title;
        Author = author;
        DataWydania = dataWydania;
    }

    public string GetTitle() => Title;

    public virtual void View()
    {
        Console.WriteLine($"Tytuł: {Title}, Autor: {Author}, Data wydania: {DataWydania.ToShortDateString()}");
    }
}
